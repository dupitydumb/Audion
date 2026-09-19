import { get } from 'svelte/store';
import { currentTrack, isPlaying, togglePlay, nextTrack, previousTrack, currentTime, duration, shuffle, repeat, toggleShuffle, cycleRepeat, playTrackById } from '$lib/stores/player';
import { nativeAudioStop } from '$lib/services/native-audio';
import { getTrackCoverSrc } from '$lib/api/tauri';
import { formatDuration } from '$lib/api/tauri';
import { isAndroid, isTauri } from '$lib/api/tauri';
import { isLoved, toggleLove } from '$lib/stores/loved';

interface AndroidInterface {
    startNotification(
        title: string,
        artist: string,
        album: string,
        isPlaying: boolean,
        isLoved: boolean,
        artUrl: string | null,
        currentTime: string,
        duration: string,
        isShuffled: boolean,
        repeatMode: string
    ): void;
    updateNotification(
        title: string,
        artist: string,
        album: string,
        isPlaying: boolean,
        isLoved: boolean,
        artUrl: string | null,
        currentTime: string,
        duration: string,
        isShuffled: boolean,
        repeatMode: string
    ): void;
    stopNotification(): void;
}


declare global {
    interface Window {
        AndroidMediaNotification?: AndroidInterface;
        __audionMediaAction?: (action: 'playPause' | 'next' | 'previous' | 'love' | 'stop' | 'toggleShuffle' | 'cycleRepeat') => void;
        // called from MediaSessionCompat.onPlayFromMediaId when a track is
        // tapped in android auto's browse/search UI => mediaId is one of our
        // own "track:<id>" node ids from the android_auto rust interpreter
        __audionPlayTrackId?: (mediaId: string) => void;
    }
}


let notificationInitialized = false;
let lastArtUrl: string | null = null;
let lastArtBase64: string | null = null;
let lastProgressSecond = -1;
let lastDurationSecond = -1;


export async function initAndroidNotification() {
    if (!isAndroid() || !isTauri() || notificationInitialized) return;

    console.log('[Android Notification] Initializing service bridge...');

    // Setup action handler (called from Android)
    window.__audionMediaAction = (action) => {
        console.log('[Android Notification] Action received:', action);
        switch (action) {
            case 'playPause':
                togglePlay();
                break;
            case 'next':
                nextTrack();
                break;
            case 'previous':
                previousTrack();
                break;
            case 'love':
                toggleLove();
                break;
            case 'stop':
                nativeAudioStop();
                isPlaying.set(false);
                break;
            case 'toggleShuffle':
                toggleShuffle();
                break;
            case 'cycleRepeat':
                cycleRepeat();
                break;
        }
    };

    window.__audionPlayTrackId = (mediaId) => {
        const match = mediaId.match(/^track:(\d+)$/);
        if (!match) {
            console.warn('[Android Notification] Unrecognized media id:', mediaId);
            return;
        }
        playTrackById(parseInt(match[1], 10));
    };

    // Subscribe to player state changes
    currentTrack.subscribe(async (track) => {
        if (!track) {
            window.AndroidMediaNotification?.stopNotification();
            lastArtUrl = null;
            lastArtBase64 = null;
            lastProgressSecond = -1;
            lastDurationSecond = -1;
            return;
        }

        const playing = get(isPlaying);
        const loved = get(isLoved);
        const artUrl = getTrackCoverSrc(track);
        const pos = get(currentTime);
        const dur = get(duration);

        console.log('[Android Notification][Art] track changed:', {
            title: track.title,
            track_cover_path: track.track_cover_path ?? null,
            track_cover_len: track.track_cover ? track.track_cover.length : null,
            cover_url: track.cover_url ?? null,
            resolvedArtUrl: artUrl,
        });

        let artData: string | null = null;
        // Optimize art loading: if URL changed, resolve it to base64 or pass through if http
        if (artUrl !== lastArtUrl) {
            lastArtUrl = artUrl;
            if (artUrl) {
                // NOTE: tauri's convertFileSrc on android returns "https://asset.localhost/..." for local files
                // MediaNotificationServic uses a plain URLConnection to load art, which can't reach asset.localhost
                // needs the same fetch()+
                // base64 treatment as any other local file
                const isRealHttpUrl = artUrl.startsWith('http') && !artUrl.includes('asset.localhost');
                console.log('[Android Notification][Art] artUrl changed, deciding path:', {
                    artUrl,
                    isRealHttpUrl,
                    reason: isRealHttpUrl
                        ? 'starts with http and is not asset.localhost -> pass through as-is'
                        : artUrl.includes('asset.localhost')
                            ? 'asset.localhost pseudo-host -> must fetch()+base64'
                            : 'not an http url (local asset/file/data) -> must fetch()+base64',
                });

                if (isRealHttpUrl) {
                    artData = artUrl;
                    console.log('[Android Notification][Art] passing remote URL through unchanged, length:', artData.length);
                } else {
                    // Local asset/file URL - fetch and convert to base64
                    try {
                        const response = await fetch(artUrl);
                        console.log('[Android Notification][Art] fetch() result:', {
                            ok: response.ok,
                            status: response.status,
                            contentType: response.headers.get('content-type'),
                        });
                        const blob = await response.blob();
                        artData = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                        console.log('[Android Notification][Art] converted to base64, length:', artData.length, 'prefix:', artData.slice(0, 30));
                    } catch (e) {
                        console.warn('[Android Notification] Failed to load art:', e);
                        artData = null;
                    }
                }
            } else {
                console.log('[Android Notification][Art] no artUrl for this track - clearing art');
            }
            lastArtBase64 = artData;
        } else {
            artData = lastArtBase64;
            console.log('[Android Notification][Art] artUrl unchanged, reusing cached art (present:', artData !== null, ')');
        }

        console.log('[Android Notification][Art] sending to startNotification, artData is', artData ? `present (len ${artData.length})` : 'null');

        window.AndroidMediaNotification?.startNotification(
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            playing,
            loved,
            artData,
            formatDuration(pos),
            formatDuration(dur),
            get(shuffle),
            get(repeat)
        );
    });

    isPlaying.subscribe(async (playing) => {
        const track = get(currentTrack);
        if (track) {
            const loved = get(isLoved);
            const pos = get(currentTime);
            const dur = get(duration);
            window.AndroidMediaNotification?.updateNotification(
                track.title || 'Unknown Title',
                track.artist || 'Unknown Artist',
                track.album || '',
                playing,
                loved,
                lastArtBase64,
                formatDuration(pos),
                formatDuration(dur),
                get(shuffle),
                get(repeat)
            );
        }
    });

    currentTime.subscribe((pos) => {
        const track = get(currentTrack);
        if (!track) return;

        const dur = get(duration);
        const posSecond = Math.floor(pos || 0);
        const durSecond = Math.floor(dur || 0);

        if (posSecond === lastProgressSecond && durSecond === lastDurationSecond) {
            return;
        }

        lastProgressSecond = posSecond;
        lastDurationSecond = durSecond;

        window.AndroidMediaNotification?.updateNotification(
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            get(isPlaying),
            get(isLoved),
            lastArtBase64,
            formatDuration(pos),
            formatDuration(dur),
            get(shuffle),
            get(repeat)
        );
    });

    duration.subscribe((dur) => {
        const track = get(currentTrack);
        if (!track) return;

        const pos = get(currentTime);
        const posSecond = Math.floor(pos || 0);
        const durSecond = Math.floor(dur || 0);

        if (posSecond === lastProgressSecond && durSecond === lastDurationSecond) {
            return;
        }

        lastProgressSecond = posSecond;
        lastDurationSecond = durSecond;

        window.AndroidMediaNotification?.updateNotification(
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            get(isPlaying),
            get(isLoved),
            lastArtBase64,
            formatDuration(pos),
            formatDuration(dur),
            get(shuffle),
            get(repeat)
        );
    });

    // pushes shuffle/repeat toggles made in-app (not from android auto) to the
    // session too, so auto's shuffle/repeat icons stay in sync either direction
    shuffle.subscribe(() => pushSessionUpdate());
    repeat.subscribe(() => pushSessionUpdate());

    function pushSessionUpdate() {
        const track = get(currentTrack);
        if (!track) return;

        window.AndroidMediaNotification?.updateNotification(
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            get(isPlaying),
            get(isLoved),
            lastArtBase64,
            formatDuration(get(currentTime)),
            formatDuration(get(duration)),
            get(shuffle),
            get(repeat)
        );
    }

    notificationInitialized = true;
}
