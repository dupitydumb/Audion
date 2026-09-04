// =============================================================================
// player.ts => the frontend half of the player.rs
//
// player.rs decides "what track is current and why" (next/previous/auto advance/ direct-select) and guards that decision with a generation counter 
// so a stale report from a transition the user has already skipped past can never be applied
// this file is the only thing that talks to it: it sends PlayerCommand on user action or backend telemetry, and applies whatever PlayerDirective comes back
//
// HTML5 : player.rs never times or drives it
// this just tells player.rs the HTML5 side committed actions
// the same way the native engine's own events do for native
// and applies the resulting directive the same way regardless of which backend produced it
// =============================================================================

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '$lib/api/tauri';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerTrackRef {
    id: number;
    path: string;
    duration_secs: number | null;
    is_streaming: boolean;
}

export type AdvanceReason =
    | 'user_next'
    | 'user_previous'
    | 'native_auto_advance'
    | 'native_natural_end'
    | 'user_direct_select'
    | 'html5_auto_advance'
    | 'html5_natural_end';

export type PlayerDirective =
    | { type: 'Advance'; data: { generation: number; reason: AdvanceReason; track: PlayerTrackRef; queue_index: number } }
    | { type: 'QueueExhausted'; data: { generation: number } };

// =============================================================================
// outbound commands
// =============================================================================

export async function playerSyncQueue(args: {
    tracks: PlayerTrackRef[];
    index: number;
    repeat: RepeatMode;
    shuffle: boolean;
    shuffledIndices: number[];
    shuffledIndex: number;
}): Promise<void> {
    if (!isTauri()) return;
    await invoke('player_sync_queue', {
        tracks: args.tracks,
        index: args.index,
        repeat: args.repeat,
        shuffle: args.shuffle,
        shuffledIndices: args.shuffledIndices,
        shuffledIndex: args.shuffledIndex,
    });
}

export async function playerAdvance(direction: 'next' | 'previous'): Promise<void> {
    if (!isTauri()) return;
    await invoke('player_advance', { direction });
}

export async function playerSetCurrent(index: number): Promise<void> {
    if (!isTauri()) return;
    await invoke('player_set_current', { index });
}

export async function playerNativeStarted(generation: number, trackId: number): Promise<void> {
    if (!isTauri()) return;
    await invoke('player_native_started', { generation, trackId });
}

export async function playerHtml5CrossfadeCommitted(): Promise<void> {
    if (!isTauri()) return;
    await invoke('player_html5_crossfade_committed');
}

export async function playerHtml5Ended(): Promise<void> {
    if (!isTauri()) return;
    await invoke('player_html5_ended');
}

// =============================================================================
// inbound directives
// =============================================================================

type DirectiveHandler = (directive: PlayerDirective) => void;

let _handler: DirectiveHandler | null = null;
let _unlisten: (() => void) | null = null;

/**
 * playback.ts calls this once at startup with the actual play this track logic
 * (path resolution, backend selection, store updates)
 * this module never touches player/queue/currentTrack stores directly
 * it only routes the directive to whoever owns that logic
 * helps keep store mutations in one place
 */
export function registerPlayerDirectiveHandler(handler: DirectiveHandler): void {
    _handler = handler;
}

export async function initPlayerBridge(): Promise<void> {
    if (!isTauri() || _unlisten) return;
    _unlisten = await listen<PlayerDirective>('player://event', ({ payload }) => {
        _handler?.(payload);
    });
}

export function teardownPlayerBridge(): void {
    _unlisten?.();
    _unlisten = null;
}