import { derived, get, writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '$lib/api/tauri';
import { activeBackend, currentTrack, volume } from '$lib/stores/player';
import { equalizer } from '$lib/stores/equalizer';
import { appSettings } from '$lib/stores/settings';

export type ChainVerdict = 'bit_perfect' | 'lossless' | 'processed';
export type ChainStageStatus = 'untouched' | 'modified' | 'active' | 'bypassed' | 'unknown';

export interface ChainDetail {
    label: string;
    value: string;
}

export interface ChainStage {
    id: string;
    title: string;
    subtitle: string;
    status: ChainStageStatus;
    details: ChainDetail[];
}

export interface AudionChain {
    active: boolean;
    backend: string;
    verdict: ChainVerdict;
    bit_perfect: boolean;
    reasons: string[];
    stages: ChainStage[];
}

const EMPTY_CHAIN: AudionChain = {
    active: false,
    backend: 'none',
    verdict: 'processed',
    bit_perfect: false,
    reasons: ['No track playing'],
    stages: [],
};

const nativeChain = writable<AudionChain>(EMPTY_CHAIN);
let unlistenChain: UnlistenFn | null = null;
let initPromise: Promise<void> | null = null;

export async function refreshAudioChain(): Promise<void> {
    if (!isTauri()) return;
    try {
        const chain = await invoke<AudionChain>('get_audio_chain');
        nativeChain.set(chain);
    } catch (err) {
        console.warn('[AudionChain] Failed to fetch audio chain:', err);
    }
}

export async function initAudioChainListener(): Promise<void> {
    if (!isTauri()) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
        if (!unlistenChain) {
            unlistenChain = await listen<AudionChain>('audio_chain_updated', (event) => {
                if (event.payload) {
                    nativeChain.set(event.payload);
                }
            });
        }
        await refreshAudioChain();
    })();
    return initPromise;
}

export function destroyAudioChainListener(): void {
    if (unlistenChain) {
        unlistenChain();
        unlistenChain = null;
    }
    initPromise = null;
}

function buildHtml5Chain(): AudionChain {
    const track = get(currentTrack);
    if (!track) return EMPTY_CHAIN;

    const eq = get(equalizer);
    const settings = get(appSettings);
    const vol = get(volume);
    const fmt = track.format ? track.format.toUpperCase() : 'Stream';
    const isUnity = Math.abs(vol - 1.0) <= 0.001;

    const reasons: string[] = ['HTML5 / WebView audio pipeline (OS mixer active)'];
    if (eq.enabled) reasons.push('WebAudio Equalizer active');
    if (settings.replayGainEnabled) reasons.push('ReplayGain enabled');
    if (settings.crossfadeSeconds > 0) reasons.push(`Crossfade enabled (${settings.crossfadeSeconds}s)`);
    if (!isUnity) reasons.push(`Software volume scaling (${Math.round(vol * 100)}%)`);

    return {
        active: true,
        backend: 'html5',
        verdict: 'processed',
        bit_perfect: false,
        reasons,
        stages: [
            {
                id: 'source',
                title: 'Source',
                subtitle: `${fmt}${track.bitrate ? ` • ${track.bitrate} kbps` : ' • Unknown bitrate'}`,
                status: 'unknown',
                details: [
                    { label: 'Format', value: fmt },
                    { label: 'Bitrate', value: track.bitrate ? `${track.bitrate} kbps` : 'Unknown' },
                    { label: 'Bit Depth', value: 'Unknown' },
                ],
            },
            {
                id: 'decoder',
                title: 'Decoder',
                subtitle: 'WebView Media Engine • Unknown internal format',
                status: 'unknown',
                details: [
                    { label: 'Decoder', value: 'Browser / WebView HTML5' },
                    { label: 'Decoded Format', value: 'Unknown' },
                ],
            },
            {
                id: 'processing',
                title: 'Processing',
                subtitle: eq.enabled ? 'WebAudio EQ • ReplayGain' : 'WebAudio / Browser Mixer',
                status: eq.enabled || settings.replayGainEnabled || settings.crossfadeSeconds > 0 ? 'modified' : 'bypassed',
                details: [
                    { label: 'Equalizer', value: eq.enabled ? 'Active' : 'Off' },
                    { label: 'ReplayGain', value: settings.replayGainEnabled ? 'Enabled' : 'Off' },
                    { label: 'Crossfade', value: settings.crossfadeSeconds > 0 ? `${settings.crossfadeSeconds}s` : 'Off' },
                ],
            },
            {
                id: 'volume',
                title: 'Volume Control',
                subtitle: isUnity ? 'Software • 100% (Unity Gain)' : `Software • ${Math.round(vol * 100)}%`,
                status: isUnity ? 'untouched' : 'modified',
                details: [
                    { label: 'Mode', value: 'Software (HTMLAudioElement)' },
                    { label: 'Gain', value: isUnity ? '100% (Unity Gain)' : `${Math.round(vol * 100)}%` },
                ],
            },
            {
                id: 'output',
                title: 'Output',
                subtitle: 'OS Audio Mixer (Shared)',
                status: 'modified',
                details: [
                    { label: 'Host API', value: 'WebView -> OS Mixer' },
                    { label: 'Bit Depth / Rate', value: 'Unknown (OS managed)' },
                ],
            },
        ],
    };
}

export const audioChain = derived(
    [nativeChain, activeBackend, currentTrack, equalizer, appSettings, volume],
    ([$native, $backend, $track]) => {
        if (!$track) return EMPTY_CHAIN;
        if ($backend === 'html5') return buildHtml5Chain();
        return $native;
    }
);
