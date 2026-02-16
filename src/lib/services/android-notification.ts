import { get } from 'svelte/store';
import { currentTrack, isPlaying, togglePlay, nextTrack, previousTrack } from '$lib/stores/player';
import { nativeAudioStop } from '$lib/services/native-audio';
import { getTrackCoverSrc } from '$lib/api/tauri';
import { isAndroid, isTauri } from '$lib/api/tauri';

interface AndroidInterface {
    startNotification(title: string, artist: string, album: string, isPlaying: boolean, artUrl: string | null): void;
    updateNotification(title: string, artist: string, album: string, isPlaying: boolean, artUrl: string | null): void;
    stopNotification(): void;
}

declare global {
    interface Window {
        AndroidMediaNotification?: AndroidInterface;
        __audionMediaAction?: (action: 'playPause' | 'next' | 'previous' | 'stop') => void;
    }
}

let notificationInitialized = false;
let lastArtUrl: string | null = null;
let lastArtBase64: string | null = null;

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
            case 'stop':
                nativeAudioStop();
                // We should probably pause if native stop isn't enough context?
                // Actually nativeAudioStop calls rust backend. The player store might need to update state.
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
            return;
        }

        const playing = get(isPlaying);
        const artUrl = getTrackCoverSrc(track);

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
            artData
        );
    });

    isPlaying.subscribe((playing) => {
        const track = get(currentTrack);
        if (track) {
            // Update play/pause state without reloading art if possible
            // Note: Our Kotlin implementation re-uses cached bitmap if URL is same/null
            // We pass consistent artData (which is cached here too)
            window.AndroidMediaNotification?.updateNotification(
                track.title || 'Unknown Title',
                track.artist || 'Unknown Artist',
                track.album || '',
                playing,
                lastArtBase64
            );
        }
    });

    notificationInitialized = true;
}
