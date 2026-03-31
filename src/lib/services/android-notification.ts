
import { get } from 'svelte/store';
import { currentTrack, isPlaying, togglePlay, nextTrack, previousTrack, currentTime, duration } from '$lib/stores/player';
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
        duration: string
    ): void;
    updateNotification(
        title: string,
        artist: string,
        album: string,
        isPlaying: boolean,
        isLoved: boolean,
        artUrl: string | null,
        currentTime: string,
        duration: string
    ): void;
    stopNotification(): void;
}


declare global {
    interface Window {
        AndroidMediaNotification?: AndroidInterface;
        __audionMediaAction?: (action: 'playPause' | 'next' | 'previous' | 'love' | 'stop') => void;
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
        }
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

        let artData: string | null = null;
        // Optimize art loading: if URL changed, resolve it to base64 or pass through if http
        if (artUrl !== lastArtUrl) {
            lastArtUrl = artUrl;
            if (artUrl) {
                if (artUrl.startsWith('http')) {
                    artData = artUrl;
                } else {
                    // Local asset/file URL - fetch and convert to base64
                    try {
                        const response = await fetch(artUrl);
                        const blob = await response.blob();
                        artData = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                    } catch (e) {
                        console.warn('[Android Notification] Failed to load art:', e);
                        artData = null;
                    }
                }
            }
            lastArtBase64 = artData;
        } else {
            artData = lastArtBase64;
        }

        window.AndroidMediaNotification?.startNotification(
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            playing,
            loved,
            artData,
            formatDuration(pos),
            formatDuration(dur)
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
                formatDuration(dur)
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
            formatDuration(dur)
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
            formatDuration(dur)
        );
    });

    notificationInitialized = true;
}
