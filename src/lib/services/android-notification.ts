import { get } from 'svelte/store';
import { currentTrack, isPlaying, togglePlay, nextTrack, previousTrack, currentTime, duration, shuffle, repeat, toggleShuffle, cycleRepeat, playTrackById } from '$lib/stores/player';
import { nativeAudioStop } from '$lib/services/native-audio';
import { getTrackCoverSrc } from '$lib/api/tauri';
import { formatDuration } from '$lib/api/tauri';
import { isAndroid, isTauri } from '$lib/api/tauri';
import { currentTrackLiked, toggleCurrentTrackLike } from '$lib/stores/liked';

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
        __audionMediaAction?: (action: 'playPause' | 'play' | 'pause' | 'next' | 'previous' | 'love' | 'stop' | 'toggleShuffle' | 'cycleRepeat') => void;
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
let trackChangeGen = 0;
let unsubscribers: (() => void)[] = [];

export function stopAndroidNotification() {
    unsubscribers.forEach(u => u());
    unsubscribers = [];
    notificationInitialized = false;
    window.AndroidMediaNotification?.stopNotification();
}

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
            case 'play':
                if (!get(isPlaying)) togglePlay();
                break;
            case 'pause':
                if (get(isPlaying)) togglePlay();
                break;
            case 'next':
                nextTrack();
                break;
            case 'previous':
                previousTrack();
                break;
            case 'love':
                toggleCurrentTrackLike();
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
    unsubscribers.push(currentTrack.subscribe(async (track) => {
        const gen = ++trackChangeGen;
        if (!track) {
            window.AndroidMediaNotification?.stopNotification();
            lastArtUrl = null;
            lastArtBase64 = null;
            lastProgressSecond = -1;
            lastDurationSecond = -1;
            return;
        }

        const playing = get(isPlaying);
        const loved = get(currentTrackLiked);
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
                const isRealHttpUrl = artUrl.startsWith('http') && !artUrl.includes('asset.localhost');

                if (isRealHttpUrl) {
                    artData = artUrl;
                } else {
                    // Local asset/file URL - fetch and convert to base64
                    try {
                        const response = await fetch(artUrl);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const blob = await response.blob();
                        artData = await new Promise<string | null>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(blob);
                        });
                    } catch (e) {
                        console.warn('[Android Notification] Failed to load art:', e);
                        artData = null;
                    }
                }
            } else {
                console.log('[Android Notification][Art] no artUrl for this track - clearing art');
            }
            if (gen !== trackChangeGen) return;
            lastArtBase64 = artData;
        } else {
            artData = lastArtBase64;
        }

        if (gen !== trackChangeGen) return;

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
    }));

    unsubscribers.push(isPlaying.subscribe(async (playing) => {
        const track = get(currentTrack);
        if (track) {
            const loved = get(currentTrackLiked);
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
    }));

    unsubscribers.push(currentTime.subscribe((pos) => {
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
            get(currentTrackLiked),
            lastArtBase64,
            formatDuration(pos),
            formatDuration(dur),
            get(shuffle),
            get(repeat)
        );
    }));

    unsubscribers.push(duration.subscribe((dur) => {
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
            get(currentTrackLiked),
            lastArtBase64,
            formatDuration(pos),
            formatDuration(dur),
            get(shuffle),
            get(repeat)
        );
    }));

    // pushes shuffle/repeat toggles made in-app (not from android auto) to the
    // session too, so auto's shuffle/repeat icons stay in sync either direction
    unsubscribers.push(shuffle.subscribe(() => pushSessionUpdate()));
    unsubscribers.push(repeat.subscribe(() => pushSessionUpdate()));

    // pushes like/unlike made from any surface (desktop, mobile, this
    // notification itself) so the notification's heart stays in sync
    unsubscribers.push(currentTrackLiked.subscribe(() => pushSessionUpdate()));

    function pushSessionUpdate() {
        const track = get(currentTrack);
        if (!track) return;

        window.AndroidMediaNotification?.updateNotification(
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            get(isPlaying),
            get(currentTrackLiked),
            lastArtBase64,
            formatDuration(get(currentTime)),
            formatDuration(get(duration)),
            get(shuffle),
            get(repeat)
        );
    }

    notificationInitialized = true;
}
