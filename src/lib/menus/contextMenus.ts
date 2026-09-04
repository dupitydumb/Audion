/**
 * contextMenus.ts
 *
 * factory functions that build ContextMenuItem arrays for each entity type
 * components call a builder and pass the result straight to contextMenu.set
 *
 * rules:
 *  1) no svelte store subscriptions at module level. builders call get() at
 *    invocation time so the snapshot is always fresh
 *  2) component-local side effects (cache invalidation, local array mutation,
 *    rename ui state) come in via callbacks so the factory stays pure
 *  3) internal primitive builders (buildPinItem, etc) are NOT exported
 *    add options params to the entity builders if a callsite needs variation
 */

import type { ContextMenuItem } from '$lib/stores/ui';
import type { Track, Album, Artist, Playlist } from '$lib/api/tauri';
import type { PlaybackContext } from '$lib/stores/player';
import {
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deleteTrack,
    deleteAlbum,
    renamePlaylist,
    getTracksByAlbum,
    getTracksByArtist,
} from '$lib/api/tauri';
import { playTracks, addToQueue } from '$lib/stores/player';
import { playlists, loadLibrary, loadPlaylists, adjustPlaylistTrackCount } from '$lib/stores/library';
import { get } from 'svelte/store';
import { goToAlbumDetail, goToArtistDetail } from '$lib/stores/view';
import { pinItem, unpinItem, isPinned, pinnedItems } from '$lib/stores/pinned';
import { setCustomArtwork } from '$lib/stores/customArtwork';
import { setPlaylistCover } from '$lib/stores/playlistCovers';
import { addToast } from '$lib/stores/toast';
import { confirm, prompt } from '$lib/stores/dialogs';
import { canDownload, downloadTrack, needsDownloadLocation } from '$lib/services/downloadService';
import { pluginStore } from '$lib/stores/plugin-store';
import { likedTrackIds, isLiked, toggleLike, unlikeAll } from '$lib/stores/liked';

// shared availability helper ===========================================================================

/**
 * returns true when a track cannot be played because no loaded plugin
 * provides a stream resolver for its source type
 *
 * exported so TrackList, SearchResults, and DesktopHome can pass the result
 * as isUnavailable to buildTrackContextMenu
 * each component owns its own availabilityCache and is responsible for
 * invalidating it when runtime or network state changes
 */
export function isTrackUnavailable(track: Track): boolean {
    // local and server-synced tracks are always available
    if (!track.source_type || track.source_type === 'local' || track.source_type === 'server') {
        return false;
    }
    // downloaded copy: always playable regardless of plugin state
    if (track.local_src) {
        return false;
    }
    // streaming track: unavailable only when no plugin can resolve it
    const runtime = pluginStore.getRuntime();
    return !runtime || !runtime.streamResolvers.has(track.source_type);
}

// internal constants ====================================================================================

const PIN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 2L4.5 9L9 9L9 22L15 22L15 9L19.5 9L12 2Z"/></svg>`;

/** typed separator so spread sites stay readable */
const SEP: ContextMenuItem = { type: 'separator' };

/**
 * builds the go to artist menu item for a track
 * for a multi artist track it
 * becomes a submenu listing each artist separately
 */
function buildGoToArtistItem(
    t: (key: string) => string,
    artist: string | null | undefined,
    artists: string[] | undefined,
): ContextMenuItem {
    const names = artists && artists.length > 0 ? artists : (artist ? [artist] : []);

    if (names.length > 1) {
        return {
            label: t('contextMenu.goToArtist'),
            submenu: names.map((name) => ({
                label: name,
                action: () => goToArtistDetail(name),
            })),
        };
    }

    return {
        label: t('contextMenu.goToArtist'),
        action: () => goToArtistDetail(names[0] || ''),
        disabled: names.length === 0,
    };
}

type Tfn = (key: string) => string;

// internal primitive builders ==============================================================================

function buildPinItem(
    t: Tfn,
    entityType: 'album' | 'artist' | 'playlist',
    id: number | string,
): ContextMenuItem {
    const pinned = isPinned(entityType, id, get(pinnedItems));
    return {
        label: pinned ? t('contextMenu.unpinFromTop') : t('contextMenu.pinToTop'),
        icon: PIN_ICON,
        action: () => {
            if (pinned) unpinItem(entityType, id);
            else pinItem(entityType, id);
        },
    };
}

function buildChangeArtworkItem(
    t: Tfn,
    entityType: 'track' | 'album' | 'artist',
    id: number | string,
    onSuccess?: () => void,
): ContextMenuItem {
    const apply = (data: string) => {
        setCustomArtwork(entityType, id, data);
        addToast(t(`contextMenu.artworkUpdated.${entityType}`), 'success');
        onSuccess?.();
    };

    return {
        label: t('contextMenu.changeArtwork'),
        submenu: [
            {
                label: t('contextMenu.fromFile'),
                action: () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => apply(reader.result as string);
                        reader.readAsDataURL(file);
                    };
                    input.click();
                },
            },
            {
                label: t('contextMenu.fromUrl'),
                action: async () => {
                    const url = await prompt('Enter image URL:', {
                        title: 'Change Artwork',
                        placeholder: 'https://example.com/image.jpg',
                    });
                    if (url?.trim()) apply(url.trim());
                },
            },
        ],
    };
}

/**
 * change cover for playlists
 *
 * pass boundInput when the component has a hidden <input bind:this={coverInput}> in its template (PlaylistDetail)
 * pass null everywhere else and an input element will be created imperatively
 */
function buildChangeCoverItem(
    t: Tfn,
    playlistId: number,
    boundInput: HTMLInputElement | null = null,
): ContextMenuItem {
    return {
        label: t('contextMenu.changeCover'),
        submenu: [
            {
                label: t('contextMenu.fromFile'),
                action: () => {
                    if (boundInput) {
                        // template owns the input; just trigger it
                        boundInput.click();
                        return;
                    }
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.addEventListener('change', (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setPlaylistCover(playlistId, reader.result as string);
                        reader.readAsDataURL(file);
                    }, { once: true });
                    input.click();
                },
            },
            {
                label: t('contextMenu.fromUrl'),
                action: async () => {
                    const url = await prompt('Enter image URL:', {
                        title: 'Change Cover',
                        placeholder: 'https://example.com/image.jpg',
                    });
                    if (url?.trim()) setPlaylistCover(playlistId, url.trim());
                },
            },
        ],
    };
}

function buildAddToPlaylistItem(
    t: Tfn,
    onSelect: (playlistId: number) => void,
): ContextMenuItem {
    const items = get(playlists).map((p) => ({
        label: p.name,
        action: () => onSelect(p.id),
    }));

    return {
        label: t('contextMenu.addToPlaylist'),
        submenu: items.length > 0
            ? items
            : [{ label: t('contextMenu.noPlaylists'), action: () => {}, disabled: true }],
    };
}

/**
 * mov to playlist submenu: excludes the playlist the track currently lives in (sourcePlaylistId)
 * onSelect is responsible for the add+remove pair against the target id
 */
function buildMoveToPlaylistItem(
    t: Tfn,
    sourcePlaylistId: number,
    onSelect: (targetPlaylistId: number) => void,
): ContextMenuItem {
    const items = get(playlists)
        .filter((p) => p.id !== sourcePlaylistId)
        .map((p) => ({
            label: p.name,
            action: () => onSelect(p.id),
        }));

    return {
        label: t('contextMenu.moveToPlaylist'),
        submenu: items.length > 0
            ? items
            : [{ label: t('contextMenu.noPlaylists'), action: () => {}, disabled: true }],
    };
}

// public option types==========================================================================

export interface TrackMenuOptions {
    track: Track;
    trackIndex: number;
    sortedTracks: Track[];
    /**
     * computed by the caller (keeps plugin runtime out of this file)
     * pass isTrackUnavailable(track) from the component
     */
    isUnavailable: boolean;
    /**
     * id of the playlist this menu instance is rendered within
     * when set (full variant only), adds Move to Playlist and
     * Remove from Playlist items scoped to this playlist
     */
    playlistId?: number | null;
    queueTracks?: Track[] | null;
    playbackContext?: PlaybackContext;
    isTidalAvailable?: boolean;
    /**
     * controls which items are included:
     *
     *  full         => everything: play, queue, download, playlist, artwork,
     *                   navigation, metadata, remove-from-playlist, delete
     *                   used by TrackList and SearchResults
     *
     *  player       => queue, add-to-playlist, delete (no navigation, no artwork)
     *                   used by FullscreenPlayer full menu
     *
     *  home         => play, queue, navigation only
     *                   used by DesktopHome cards
     *
     *  playlist-only => just the Add to Playlist submenu
     *                    used by FullscreenPlayer mobile long-press
     */
    variant?: 'full' | 'player' | 'home' | 'playlist-only';
    /** called after artwork is changed so the component can bust its local cache */
    onArtworkCacheInvalidate?: (trackId: number) => void;
    onAvailabilityCacheInvalidate?: (trackId: number) => void;
    /** called after a track is removed or deleted with the updated array */
    onTracksUpdated?: (tracks: Track[]) => void;
    /** called to open the metadata modal for this track */
    onMetadataOpen?: (track: Track) => void;
    /** called after successful delete (e.g. FullscreenPlayer passes toggleFullScreen) */
    onAfterDelete?: () => void;
    t: Tfn;
}

export interface AlbumMenuOptions {
    album: Album;
    /** include a Play item. default true */
    showPlay?: boolean;
    /** include an Add to Queue item, right after Play. default true */
    showAddToQueue?: boolean;
    /** include a Go to Artist navigation item. default false */
    showGoToArtist?: boolean;
    /** include Delete. default false */
    showDelete?: boolean;
    /**
     * include Pin/Unpin to top. default true
     * set false on surfaces that don't reflect pin state visually
     */
    showPin?: boolean;
    /**
     * component's local playAlbum function, required when showPlay is true
     * lives in the component because it needs playingAlbumId / pausedAlbumId
     * derived state that we don't pull into this file
     */
    onPlay?: (album: Album) => void;
    /** called after successful delete (e.g. navigate back to album grid) */
    onAfterDelete?: () => void;
    t: Tfn;
}

export interface ArtistMenuOptions<A extends Artist | { name: string } = Artist> {
    artist: A;
    /** include a Play item. default true */
    showPlay?: boolean;
    /**
     * component's local playArtist function. required when showPlay is true
     * lives in the component because it needs playingArtistName / pausedArtistName
     * derived state that we don't want to pull into this module.
     */
    onPlay?: (artist: A) => void;
    t: Tfn;
}

export interface LikedSongsMenuOptions {
    /**
     * needed to disable Play / Add to Queue / Unlike All when there are no
     * liked tracks
     */
    tracks: Track[];
    onPlay?: () => void;
    onAddToQueue?: () => void;
    /** called after Unlike All completes (e.g. to show a toast or refresh) */
    onAfterUnlikeAll?: () => void;
    /** called to export all liked songs as a ZIP archive */
    onExportZip?: () => void;
    t: Tfn;
}
export interface PlaylistMenuOptions {
    playlist: Playlist;
    /**
     * used to disable Play / Add to Queue when the playlist is empty
     * omit when the caller doesn't have track data on hand (e.g. PlaylistView
     * grid cards, Sidebar entries) => Play/Add to Queue stay enabled and the
     * component's own handler no-ops on an empty playlist instead. only pass
     * this when we actually know the count (e.g. PlaylistDetail, which has
     * the full track list loaded already)
     */
    tracks?: Track[];
    /**
     * detail  => full header menu, coverInput supported (PlaylistDetail)
     * grid    => grid card menu (PlaylistView)
     * sidebar => compact sidebar entry (Sidebar). rename falls back to
     *             inline prompt when onRename is not provided
     */
    variant?: 'detail' | 'grid' | 'sidebar';
    onPlay?: () => void;
    onAddToQueue?: () => void;
    /**
     * pass the component's rename handler to delegate (detail/grid)
     * omit to fall back to an inline prompt (sidebar)
     */
    onRename?: () => void;
    onDelete?: () => void;
    /** called to export the playlist as a ZIP archive (detail variant only) */
    onExportZip?: () => void;
    /** pass a bound <input> element from the template (PlaylistDetail only) */
    coverInput?: HTMLInputElement | null;
    t: Tfn;
}

// public builders =====================================================================

export function buildTrackContextMenu(opts: TrackMenuOptions): ContextMenuItem[] {
    const {
        track,
        trackIndex,
        sortedTracks,
        isUnavailable,
        queueTracks,
        playbackContext,
        playlistId,
        isTidalAvailable = true,
        variant = 'full',
        t,
    } = opts;

    function doPlay() {
        if (queueTracks) {
            const gi = queueTracks.findIndex((qt) => qt.id === track.id);
            if (gi !== -1) {
                playTracks(queueTracks, gi, playbackContext);
                return;
            }
        }
        playTracks(sortedTracks, trackIndex, playbackContext);
    }

    const addToPlaylistItem = buildAddToPlaylistItem(t, async (pid) => {
        try {
            await addTrackToPlaylist(pid, track.id);
            adjustPlaylistTrackCount(pid, 1);
        } catch (err) {
            console.error('[contextMenus] addTrackToPlaylist failed:', err);
        }
    });

    // like/unlike => same item everywhere, label/action flip on current state
    // read fresh at build time (isLiked wraps get() internally), not subscribed
    const likeItem: ContextMenuItem = isLiked(track.id)
        ? { label: t('contextMenu.unlike'), action: () => toggleLike(track.id) }
        : { label: t('contextMenu.like'), action: () => toggleLike(track.id) };

    // playlist-only (FullscreenPlayer mobile long-press) ===============================
    if (variant === 'playlist-only') {
        return [likeItem, addToPlaylistItem];
    }

    // home (DesktopHome cards)===========================================================
    if (variant === 'home') {
        return [
            { label: t('contextMenu.play'), action: doPlay, disabled: isUnavailable },
            {
                label: t('contextMenu.addToQueue'),
                disabled: isUnavailable,
                action: () => {
                    addToQueue([track]);
                    addToast(t('contextMenu.addedToQueue'), 'success');
                },
            },
            likeItem,
            SEP,
            buildGoToArtistItem(t, track.artist, track.artists),
            {
                label: t('contextMenu.goToAlbum'),
                action: () => { if (track.album_id) goToAlbumDetail(track.album_id); },
                disabled: !track.album_id,
            },
        ];
    }

    // delete is only enabled for local tracks (used by both player and full variants below)
    const isDeletable = !track.source_type || track.source_type === 'local' || track.source_type === 'server';

    // player (FullscreenPlayer full menu) ======================================================
    if (variant === 'player') {
        return [
            {
                label: t('contextMenu.addToQueue'),
                action: () => {
                    addToQueue([track]);
                    addToast(t('contextMenu.addedToQueue'), 'success');
                },
            },
            likeItem,
            SEP,
            addToPlaylistItem,
            SEP,
            {
                label: t('contextMenu.deleteFromLibrary'),
                danger: true,
                disabled: !isDeletable,
                action: async () => {
                    if (!isDeletable) return;
                    const ok = await confirm(
                        `Are you sure you want to delete "${track.title}" from your library?`,
                        { title: 'Delete Track', confirmLabel: 'Delete', danger: true },
                    );
                    if (!ok) return;
                    try {
                        await deleteTrack(track.id);
                        await loadLibrary();
                        opts.onAfterDelete?.();
                    } catch (err) {
                        console.error('[contextMenus] deleteTrack failed:', err);
                    }
                },
            },
        ];
    }

    // full (TrackList, SearchResults)========================================================================
    //

    const items: ContextMenuItem[] = [
        { label: t('contextMenu.play'), action: doPlay, disabled: isUnavailable },
        SEP,
        {
            label: t('contextMenu.addToQueue'),
            disabled: isUnavailable,
            action: () => {
                addToQueue([track]);
                addToast(t('contextMenu.addedToQueue'), 'success');
            },
        },
        likeItem,
        SEP,
        {
            label: t('contextMenu.download'),
            disabled: !canDownload(track) || (isUnavailable && !isTidalAvailable && !track.local_src),
            action: async () => {
                if (needsDownloadLocation()) {
                    addToast(t('contextMenu.configureDownloadLocation'), 'error');
                    return;
                }
                addToast(`Downloading "${track.title}"...`, 'info');
                try {
                    await downloadTrack(track);
                    addToast(`Downloaded "${track.title}"`, 'success');
                } catch (err) {
                    console.error('[contextMenus] downloadTrack failed:', err);
                    addToast(`Failed to download "${track.title}"`, 'error');
                }
            },
        },
        SEP,
        addToPlaylistItem,
        SEP,
        buildChangeArtworkItem(t, 'track', track.id, () => {
            opts.onArtworkCacheInvalidate?.(track.id);
        }),
        SEP,
        buildGoToArtistItem(t, track.artist, track.artists),
        {
            label: t('contextMenu.goToAlbum'),
            action: () => { if (track.album_id) goToAlbumDetail(track.album_id); },
            disabled: !track.album_id,
        },
        SEP,
        {
            label: t('contextMenu.showMoreInfo'),
            action: () => opts.onMetadataOpen?.(track),
        },
    ];

    if (playlistId) {
        items.push(
            buildMoveToPlaylistItem(t, playlistId, async (targetPlaylistId) => {
                try {
                    // add first so a failed remove doesn't lose the track entirely
                    await addTrackToPlaylist(targetPlaylistId, track.id);
                    await removeTrackFromPlaylist(playlistId, track.id);
                    opts.onTracksUpdated?.(sortedTracks.filter((t) => t.id !== track.id));
                    // in memory only:
                    // every subscriber (sidebar etc) reading the shared playlistTrackCounts
                    adjustPlaylistTrackCount(targetPlaylistId, 1);
                    adjustPlaylistTrackCount(playlistId, -1);
                    addToast(t('contextMenu.trackMoved'), 'success');
                } catch (err) {
                    console.error('[contextMenus] moveTrackToPlaylist failed:', err);
                    addToast(t('contextMenu.trackMoveFailed'), 'error');
                }
            }),
            {
                label: t('contextMenu.removeFromPlaylist'),
                action: async () => {
                    try {
                        await removeTrackFromPlaylist(playlistId, track.id);
                        opts.onTracksUpdated?.(sortedTracks.filter((t) => t.id !== track.id));
                        adjustPlaylistTrackCount(playlistId, -1);
                    } catch (err) {
                        console.error('[contextMenus] removeTrackFromPlaylist failed:', err);
                    }
                },
            },
        );
    }

    items.push(
        SEP,
        {
            label: t('contextMenu.deleteFromLibrary'),
            danger: true,
            disabled: !isDeletable,
            action: async () => {
                const ok = await confirm(
                    `Are you sure you want to delete "${track.title}" from your library? This will also remove the file from your computer.`,
                    { title: 'Delete Track', confirmLabel: 'Delete', danger: true },
                );
                if (!ok) return;
                try {
                    await deleteTrack(track.id);
                    opts.onArtworkCacheInvalidate?.(track.id);
                    opts.onAvailabilityCacheInvalidate?.(track.id);
                    await loadLibrary();
                    opts.onTracksUpdated?.(sortedTracks.filter((t) => t.id !== track.id));
                } catch (err) {
                    console.error('[contextMenus] deleteTrack failed:', err);
                }
            },
        },
    );

    return items;
}

export function buildAlbumContextMenu(opts: AlbumMenuOptions): ContextMenuItem[] {
    const {
        album,
        showPlay = true,
        showAddToQueue = true,
        showGoToArtist = false,
        showDelete = false,
        showPin = true,
        t,
    } = opts;

    return [
        ...(showPlay ? [
            { label: t('contextMenu.play'), action: () => opts.onPlay?.(album) },
        ] : []),
        ...(showAddToQueue ? [
            {
                label: t('contextMenu.addToQueue'),
                action: async () => {
                    try {
                        const tracks = await getTracksByAlbum(album.id);
                        if (tracks.length === 0) return;
                        addToQueue(tracks);
                        addToast(t('contextMenu.addedToQueue'), 'success');
                    } catch (err) {
                        console.error('[contextMenus] getTracksByAlbum failed:', err);
                    }
                },
            },
        ] : []),
        ...(showPlay || showAddToQueue ? [SEP] : []),
        ...(showPin ? [
            buildPinItem(t, 'album', album.id),
            SEP,
        ] : []),
        buildChangeArtworkItem(t, 'album', album.id),
        ...(showGoToArtist ? [
            SEP,
            {
                label: t('contextMenu.goToArtist'),
                action: () => goToArtistDetail(album.artist || ''),
                disabled: !album.artist,
            },
        ] : []),
        ...(showDelete ? [
            SEP,
            {
                label: t('contextMenu.deleteAlbum'),
                danger: true,
                action: async () => {
                    const ok = await confirm(
                        `Are you sure you want to delete the album "${album.name}"? This will delete all songs in this album from your computer.`,
                        { title: 'Delete Album', confirmLabel: 'Delete', danger: true },
                    );
                    if (!ok) return;
                    try {
                        await deleteAlbum(album.id);
                        await loadLibrary();
                        opts.onAfterDelete?.();
                    } catch (err) {
                        console.error('[contextMenus] deleteAlbum failed:', err);
                    }
                },
            },
        ] : []),
    ];
}

export function buildArtistContextMenu<A extends Artist | { name: string } = Artist>(opts: ArtistMenuOptions<A>): ContextMenuItem[] {
    const { artist, showPlay = true, t } = opts;

    // bulk-add all tracks by this artist to the target playlist
    // no dedicated addArtistToPlaylist backend command; we load the
    // artist's tracks via getTracksByArtist and fan out addTrackToPlaylist calls
    const addToPlaylistItem = buildAddToPlaylistItem(t, async (pid) => {
        try {
            const tracks = await getTracksByArtist(artist.name);
            if (tracks.length === 0) return;
            const results = await Promise.allSettled(
                tracks.map((track) => addTrackToPlaylist(pid, track.id)),
            );
            const succeeded = results.filter((r) => r.status === 'fulfilled').length;
            if (succeeded > 0) {
                adjustPlaylistTrackCount(pid, succeeded);
            }
            const failed = results.length - succeeded;
            if (failed > 0) {
                console.error(
                    `[contextMenus] addArtistToPlaylist: ${failed} of ${results.length} tracks failed to add`,
                    results.filter((r) => r.status === 'rejected'),
                );
            }
        } catch (err) {
            console.error('[contextMenus] addArtistToPlaylist failed:', err);
        }
    });

    return [
        ...(showPlay ? [
            { label: t('contextMenu.play'), action: () => opts.onPlay?.(artist) },
            SEP,
        ] : []),
        buildPinItem(t, 'artist', artist.name),
        SEP,
        buildChangeArtworkItem(t, 'artist', artist.name),
        SEP,
        addToPlaylistItem,
    ];
}

export function buildPlaylistContextMenu(opts: PlaylistMenuOptions): ContextMenuItem[] {
    const {
        playlist,
        tracks,
        onPlay,
        onAddToQueue,
        onRename,
        onDelete,
        onExportZip,
        coverInput = null,
        t,
    } = opts;

    // only disable when the caller actually knows the track count. if tracks
    // is omitted (PlaylistView, Sidebar => no synchronous track data available),
    // stay enabled; their onPlay/onAddToQueue handlers already no-op safely on
    // an empty playlist after fetching tracks themselves
    const isEmpty = tracks !== undefined && tracks.length === 0;

    // rename: delegate to component flow when provided, fall back to inline
    // prompt for Sidebar which has no rename modal state
    const renameItem: ContextMenuItem = onRename
        ? { label: t('contextMenu.rename'), action: onRename }
        : {
            label: t('contextMenu.rename'),
            action: async () => {
                const newName = await prompt('Enter new name:', {
                    initialValue: playlist.name,
                    title: 'Rename Playlist',
                });
                if (newName?.trim() && newName !== playlist.name) {
                    try {
                        await renamePlaylist(playlist.id, newName.trim());
                        await loadPlaylists();
                    } catch (err) {
                        console.error('[contextMenus] renamePlaylist failed:', err);
                    }
                }
            },
        };

    return [
        { label: t('contextMenu.play'), action: onPlay, disabled: isEmpty },
        { label: t('contextMenu.addToQueue'), action: onAddToQueue, disabled: isEmpty },
        SEP,
        ...(onExportZip ? [
            {
                label: t('contextMenu.exportToZip'),
                disabled: isEmpty,
                action: onExportZip,
            },
            SEP,
        ] : []),
        buildPinItem(t, 'playlist', playlist.id),
        SEP,
        renameItem,
        buildChangeCoverItem(t, playlist.id, coverInput),
        SEP,
        {
            label: t('contextMenu.deletePlaylist'),
            danger: true,
            action: onDelete,
        },
    ];
}

// liked songs
export function buildLikedSongsContextMenu(opts: LikedSongsMenuOptions): ContextMenuItem[] {
    const { tracks, onPlay, onAddToQueue, t } = opts;
    const isEmpty = tracks.length === 0;

    return [
        { label: t('contextMenu.play'), action: onPlay, disabled: isEmpty },
        { label: t('contextMenu.addToQueue'), action: onAddToQueue, disabled: isEmpty },
        SEP,
        {
            label: t('contextMenu.exportToZip'),
            disabled: isEmpty,
            action: () => opts.onExportZip?.(),
        },
        SEP,
        {
            label: t('contextMenu.unlikeAll'),
            danger: true,
            disabled: isEmpty,
            action: async () => {
                const ok = await confirm(
                    `Are you sure you want to unlike all ${tracks.length} liked song${tracks.length === 1 ? '' : 's'}? This cannot be undone.`,
                    { title: 'Unlike All', confirmLabel: 'Unlike All', danger: true },
                );
                if (!ok) return;
                const failedCount = await unlikeAll();
                if (failedCount > 0) {
                    addToast(
                        `Unliked all but ${failedCount} track${failedCount === 1 ? '' : 's'} (failed to sync)`,
                        'error',
                    );
                }
                opts.onAfterUnlikeAll?.();
            },
        },
    ];
}