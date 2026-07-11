// Core playback: playTrack, togglePlay, pause, resume, seek, setVolume,
// nextTrack, previousTrack, playTracks, playFromQueue, toggleShuffle, cycleRepeat,
// handleTrackEnd, handleGaplessAdvance, gapless preload scheduling.
import { get } from 'svelte/store';
import type { Track } from '$lib/api/tauri';
import {
    getAudioSrc, getTrackCoverSrc, audioResolvePath, audioGetStreamUrl, convertFileSrc
} from '$lib/api/tauri';
import { invoke } from '@tauri-apps/api/core';
import { addToast } from '$lib/stores/toast';
import { appSettings } from '$lib/stores/settings';
import { tracks as libraryTracks, getFullTrack, updateTrackCover } from '$lib/stores/library';
import { fetchTrackCover } from '$lib/services/cover-fetcher';
import { recordTrackPlay } from '$lib/stores/activity';
import { submitListenbrainzListen } from '$lib/api/tauri';
import { activeRemoteDevice } from '$lib/stores/websocket';
import { pluginStore } from '$lib/stores/plugin-store';
import {
    nativeAudioPlay, nativeAudioPreload, nativeAudioPause, nativeAudioResume,
    nativeAudioStop, nativeAudioSetVolume, nativeAudioSeek, nativeAudioSetRepeatOne,
    nativeAudioTriggerCrossfade,
} from '$lib/services/native-audio';
import {
    html5Play, html5Pause, html5Resume, html5Stop, html5Seek,
    html5SetVolume, html5SwapPreload, html5Preload, html5StartCrossfade,
} from '$lib/services/html5-audio';
import {
    activeBackend, currentTrack, currentTime, duration, isPlaying,
    queue, queueIndex, userQueueCount, volume, shuffle, repeat,
    shuffledIndices, shuffledIndex, playbackContext, pluginEvents,
    classifyAudioPath, isStreaming, sliderToAudioVolume,
    nativeAudioUsed, NATIVE_ERROR_FALLBACK_THRESHOLD,
    incrementNativeErrorCount, resetNativeErrorCount, setNativeAudioUsed,
    nextSessionId, currentSessionId, playStartTime,
    type PlaybackContext,
} from './stores';
import {
    _startReckoning, _stopReckoning, _correctReckoning,
    resetCrossfadeFlags, setNativePreloadScheduled, _hasCrossfaded, _nativePreloadScheduled,
    registerCrossfadeCallback, registerHtml5CrossfadeCallback,
} from './reckoning';
import {
    updateMediaSessionMetadata, updateMediaSessionPlaybackState, updateMediaSessionPosition,
    updateSmtcMetadata, updateSmtcPlaybackState,
} from './media-session';
import { _advanceQueueIndex, shuffleArray, registerReorderCallback } from './queue';
import { sendRemoteCommand, throttledRemoteCommand } from './remote';
import { wsStore } from '$lib/stores/websocket';

// Module-level mutable state (mirrors the original module-level vars)
let _currentSessionId = 0;
let _playStartTime: number = 0;
let _nativeAudioUsed = false;
let _nativeErrCount = 0;

// ─── Broadcast ────────────────────────────────────────────────────────────────

let lastBroadcast = 0;
export function broadcastState(force = false) {
    if (get(activeBackend) === 'remote') return;

    const now = Date.now();
    if (!force && now - lastBroadcast < 2000) return;

    const track = get(currentTrack);
    const playing = get(isPlaying);
    const pos = get(currentTime);
    const dur = get(duration);

    if (track || lastBroadcast === 0) {
        wsStore.send('player_state', {
            track: track ? {
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                coverUrl: getTrackCoverSrc(track)
            } : null,
            isPlaying: playing,
            currentTime: pos,
            duration: dur,
            volume: get(volume),
            shuffle: get(shuffle),
            repeat: get(repeat)
        });
        lastBroadcast = now;
    }
}

// ─── Crossfade triggers ───────────────────────────────────────────────────────

async function _triggerHtml5Crossfade(): Promise<void> {
    const q = get(queue);
    const nextIdx = _advanceQueueIndex(true);
    if (nextIdx === null || nextIdx >= q.length) {
        return;
    }

    const nextTrackObj = q[nextIdx];
    if (!nextTrackObj) return;

    const streaming = isStreaming(nextTrackObj) || !!(nextTrackObj as any).stream_url || (nextTrackObj.path && (nextTrackObj.path.startsWith('http://') || nextTrackObj.path.startsWith('https://')));
    if (!streaming) {
        return;
    }

    const settings = get(appSettings);
    const vol = sliderToAudioVolume(get(volume));
    console.log('[Player] Triggering HTML5 crossfade into next track:', nextTrackObj.title);

    const started = await html5StartCrossfade(nextTrackObj.id, vol, settings.crossfadeSeconds);
    if (started) {
        handleGaplessAdvance();
    } else {
        // reset so the tick can retry
        (reckoning as any)._hasCrossfaded = false;
    }
}

async function _triggerNativeCrossfade(): Promise<void> {
    console.log('[Player] Triggering native crossfade');
    try {
        await nativeAudioTriggerCrossfade();
        // Do NOT call handleGaplessAdvance() here — backend emits TrackAdvanced
    } catch (err) {
        console.warn('[Player] Native crossfade failed:', err);
        // reset flag via reckoning module
    }
}

// Wire up crossfade callbacks into reckoning module
import * as reckoning from './reckoning';
reckoning.registerCrossfadeCallback(() => void _triggerNativeCrossfade());
reckoning.registerHtml5CrossfadeCallback(() => void _triggerHtml5Crossfade());

// Wire up reorder → reschedule preload
registerReorderCallback(() => _schedulePreload());

// ─── Core playback ────────────────────────────────────────────────────────────

export async function playTrack(track: Track, skipLocalSrc = false, startTime = 0): Promise<void> {
    const previousTrackObj = get(currentTrack);
    const sessionId = ++_currentSessionId;

    // Record play for the previous track (if any)
    if (previousTrackObj && _playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - _playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(previousTrackObj.id, previousTrackObj.album_id ?? null, durationPlayed);
            const trackDuration = previousTrackObj.duration ?? 0;
            if (get(appSettings).listenBrainzEnabled && trackDuration > 0) {
                const threshold = Math.min(Math.floor(trackDuration / 2), 240);
                if (durationPlayed >= threshold) {
                    submitListenbrainzListen(
                        previousTrackObj.artist ?? 'Unknown Artist',
                        previousTrackObj.title ?? 'Unknown',
                        previousTrackObj.album,
                        previousTrackObj.duration,
                        false,
                    ).catch(e => console.warn('[ListenBrainz] Scrobble failed:', e));
                }
            }
        }
    }
    _playStartTime = Date.now();

    if (get(appSettings).listenBrainzEnabled) {
        submitListenbrainzListen(
            track.artist ?? 'Unknown Artist',
            track.title ?? 'Unknown',
            track.album,
            track.duration,
            true,
        ).catch(e => console.warn('[ListenBrainz] Now-playing failed:', e));
    }

    const fullTrack = await getFullTrack(track.id, true);

    if (sessionId !== _currentSessionId) return;

    const trackForPlugins = fullTrack || track;
    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack: previousTrackObj });

    console.log('[Player] Preparing MediaSession metadata for:', trackForPlugins.title);
    await updateMediaSessionMetadata(trackForPlugins);
    await updateSmtcMetadata(trackForPlugins).catch(e => console.warn('[Player] SMTC metadata update failed:', e));

    if (!track.track_cover_path && !track.cover_url) {
        fetchTrackCover(track).then(async (newCoverUrl) => {
            if (newCoverUrl) {
                console.log(`[Player] Auto-fetched cover for "${track.title}": ${newCoverUrl}`);

                try {
                    await invoke('update_track_cover_url', { trackId: track.id, coverUrl: newCoverUrl });
                } catch (e) {
                    console.error('[Player] Failed to persist fetched cover to database:', e);
                }

                updateTrackCover(track.id, newCoverUrl);

                const current = get(currentTrack);
                if (current && current.id === track.id) {
                    currentTrack.update(t => t ? { ...t, cover_url: newCoverUrl } : t);
                    updateMediaSessionMetadata({ ...track, cover_url: newCoverUrl }).catch(() => { });
                    updateSmtcMetadata({ ...track, cover_url: newCoverUrl }).catch(() => { });
                }
            }
        }).catch(err => {
            console.error('[Player] Failed to auto-fetch cover:', err);
        });
    }

    if (sessionId !== _currentSessionId) {
        console.log('[Player] Session changed during metadata update, aborting playback');
        return;
    }

    try {
        let audioPath = track.local_src || track.path;

        // Resolve server tracks before checking/preparing backends
        if (track.source_type === 'server' && !track.local_src) {
            if (get(appSettings).streamServerTracks) {
                try {
                    audioPath = await audioGetStreamUrl(audioPath, track.id);
                } catch (err) {
                    console.error('[Player] Failed to get server stream URL:', err);
                    throw new Error(`Failed to get stream URL from server: ${err instanceof Error ? err.message : String(err)}`);
                }
            } else {
                if (_nativeAudioUsed) {
                    try {
                        audioPath = await audioResolvePath(audioPath, track.id);
                        track.local_src = audioPath;
                    } catch (err) {
                        console.error('[Player] Failed to resolve server track path:', err);
                        throw new Error(`Failed to download/resolve track from server: ${err instanceof Error ? err.message : String(err)}`);
                    }
                } else {
                    try {
                        audioPath = await audioGetStreamUrl(audioPath, track.id);
                    } catch (err) {
                        console.error('[Player] Failed to get server stream URL:', err);
                        throw new Error(`Failed to get stream URL from server: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            }
        }

        if (!audioPath && (track as any).stream_url) {
            audioPath = (track as any).stream_url;
        }

        if (!audioPath && track.external_id && (track.external_id.startsWith('http://') || track.external_id.startsWith('https://'))) {
            audioPath = track.external_id;
        }

        const streaming = isStreaming(track) || !!(track as any).stream_url || audioPath.startsWith('http://') || audioPath.startsWith('https://');

        let swapped = false;
        if (startTime === 0) {
            swapped = await html5SwapPreload(track.id, sliderToAudioVolume(get(volume)));
        }

        if (swapped) {
            activeBackend.set('html5');
            console.log('[Player] HTML5 swapped from preload:', track.title);
            _scheduleHtml5Preload();
        } else {
            if (streaming) {
                if (!audioPath) {
                    throw new Error('No audio path or stream URL found for track');
                }

                await nativeAudioStop().catch(() => { });

                if (classifyAudioPath(audioPath) === 'custom-scheme') {
                    const runtime = pluginStore.getRuntime();
                    if (runtime) {
                        const sourceType = track.source_type;
                        const externalId = track.external_id;
                        if (sourceType && externalId) {
                            console.log(`[Player] Resolving custom scheme: ${audioPath}`);
                            const resolved = await runtime.resolveStreamUrl(sourceType, externalId, { track: trackForPlugins });
                            if (resolved) {
                                audioPath = resolved;
                            } else {
                                throw new Error(`Failed to resolve stream URL for ${sourceType}`);
                            }
                        }
                    }
                }

                activeBackend.set('html5');
                await html5Play(audioPath, sliderToAudioVolume(get(volume)), startTime, (track as any).replay_gain_db ?? null);
                console.log('[Player] HTML5 streaming started:', track.title);
                _scheduleHtml5Preload();

            } else {
                if (!audioPath) {
                    throw new Error('No local audio path found for track');
                }

                if (_nativeAudioUsed) {
                    html5Stop();

                    console.log('[Player] Invoking nativeAudioPlay for track:', track.id);

                    try {
                        await nativeAudioPlay(audioPath, track.id, (track as any).replay_gain_db ?? null);
                        console.log('[Player] nativeAudioPlay resolved OK');
                    } catch (nativeErr) {
                        console.error('[Player] nativeAudioPlay rejected for track:', track.id, nativeErr);
                        throw nativeErr;
                    }
                    activeBackend.set('native');

                    const vol = sliderToAudioVolume(get(volume));
                    await nativeAudioSetVolume(vol);

                    if (startTime > 0 && track.duration) {
                        await nativeAudioSeek(startTime / track.duration);
                    }

                    _schedulePreload();
                    _nativeErrCount = 0;
                    console.log('[Player] Native playback started:', track.title);
                } else {
                    activeBackend.set('html5');
                    await html5Play(convertFileSrc(audioPath), sliderToAudioVolume(get(volume)), startTime, (track as any).replay_gain_db ?? null);
                    console.log('[Player] Local playback started via HTML5:', track.title);
                    _scheduleHtml5Preload();
                }
            }
        }

        resetCrossfadeFlags();
        currentTrack.set(trackForPlugins);
        currentTime.set(startTime);
        duration.set(track.duration || 0);
        isPlaying.set(true);

        if (get(activeBackend) === 'native') {
            _startReckoning(startTime);
        }

        updateMediaSessionPlaybackState('playing');
        updateMediaSessionPosition();
        updateSmtcPlaybackState('playing');
        broadcastState(true);

    } catch (err) {
        console.error('[Player] Playback failed:', err);
        console.error('[Player] Playback failed type:', typeof err);
        console.error('[Player] Playback failed JSON:', JSON.stringify(err));
        addToast(`Playback failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
}

export function playTracks(
    tracks: Track[],
    startIndex: number = 0,
    context?: PlaybackContext
): void {
    const currentQueue = get(queue);

    let isSameQueue = false;

    if (tracks.length === currentQueue.length) {
        if (tracks.length === 0) {
            isSameQueue = true;
        } else {
            if (tracks[0].id === currentQueue[0].id &&
                tracks[tracks.length - 1].id === currentQueue[currentQueue.length - 1].id) {
                isSameQueue = tracks.every((t, i) => t.id === currentQueue[i].id);
            }
        }
    }

    if (!isSameQueue) {
        queue.set(tracks);
    }

    queueIndex.set(startIndex);
    userQueueCount.set(0);

    playbackContext.set(context ?? null);

    if (get(shuffle)) {
        const allIndices = tracks.map((_, i) => i);
        const otherIndices = allIndices.filter(i => i !== startIndex);
        const shuffledOthers = shuffleArray(otherIndices);
        const newShuffledIndices = [startIndex, ...shuffledOthers];

        console.log(`Regenerating shuffle with forced start: ${startIndex}`);
        shuffledIndices.set(newShuffledIndices);
        shuffledIndex.set(0);
    }

    pluginEvents.emit('queueChange', { queue: tracks, index: startIndex });

    if (tracks.length > 0 && startIndex < tracks.length) {
        playTrack(tracks[startIndex]);
    }
}

export async function togglePlay(): Promise<void> {
    if (get(isPlaying)) {
        await pause();
    } else {
        await resume();
    }
}

export async function pause(): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'pause');
        }
        return;
    }

    try {
        if (get(activeBackend) === 'html5') {
            html5Pause();
        } else if (get(activeBackend) === 'native') {
            await nativeAudioPause();
            _stopReckoning(get(currentTime));
        }
        isPlaying.set(false);
        updateMediaSessionPlaybackState('paused');
        updateSmtcPlaybackState('paused');
        broadcastState(true);
    } catch (err) {
        console.error('[Player] Pause failed:', err);
    }
}

export async function resume(): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'resume');
        }
        return;
    }

    try {
        const track = get(currentTrack);
        if (!track) return;

        if (get(currentTime) >= get(duration) && get(duration) > 0) {
            await playTrack(track);
        } else if (get(activeBackend) === 'none') {
            await playTrack(track, false, get(currentTime));
        } else if (get(activeBackend) === 'html5') {
            await html5Resume();
            isPlaying.set(true);
            updateMediaSessionPlaybackState('playing');
        } else if (get(activeBackend) === 'native') {
            await nativeAudioResume();
            isPlaying.set(true);
            updateMediaSessionPlaybackState('playing');
            _startReckoning(get(currentTime));
        }
        updateSmtcPlaybackState('playing');
        updateMediaSessionPosition();
        broadcastState(true);
    } catch (err) {
        console.error('[Player] Resume failed:', err);
    }
}

export function nextTrack(): void {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'next');
        }
        return;
    }

    const q = get(queue);
    const settings = get(appSettings);

    if (q.length === 0) {
        if (settings.autoplay) playRandomFromLibrary();
        return;
    }

    const idx = _advanceQueueIndex();

    if (idx === null) {
        if (settings.autoplay) {
            playRandomFromLibrary();
        } else {
            isPlaying.set(false);
        }
        return;
    }

    queueIndex.set(idx);
    playTrack(q[idx]);
}

function playRandomFromLibrary(): void {
    const allTracks = get(libraryTracks);
    if (allTracks.length === 0) {
        isPlaying.set(false);
        return;
    }

    const current = get(currentTrack);
    let availableTracks = allTracks;

    if (current && allTracks.length > 1) {
        availableTracks = allTracks.filter(t => t.id !== current.id);
    }

    const randomIndex = Math.floor(Math.random() * availableTracks.length);
    const randomTrack = availableTracks[randomIndex];

    queue.update(q => [...q, randomTrack]);
    const newQueue = get(queue);
    queueIndex.set(newQueue.length - 1);

    playTrack(randomTrack);
}

export async function previousTrack(): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'previous');
        }
        return;
    }

    const q = get(queue);
    const shuf = get(shuffle);
    let idx = get(queueIndex);

    if (q.length === 0) return;

    try {
        let pos = get(currentTime);

        if (pos > 3) {
            if (get(activeBackend) === 'html5') {
                html5Seek(0);
            } else if (get(activeBackend) === 'native') {
                await nativeAudioSeek(0);
            }
            return;
        }
    } catch (err) {
        console.error('[Player] Restart track failed:', err);
    }

    if (shuf) {
        const shufIndices = get(shuffledIndices);
        let shufIdx = get(shuffledIndex);

        shufIdx = shufIdx - 1;
        if (shufIdx < 0) {
            shufIdx = get(repeat) === 'all' ? shufIndices.length - 1 : 0;
        }

        shuffledIndex.set(shufIdx);
        idx = shufIndices[shufIdx];
    } else {
        idx = idx - 1;
        if (idx < 0) {
            idx = get(repeat) === 'all' ? q.length - 1 : 0;
        }
    }

    queueIndex.set(idx);
    playTrack(q[idx]);
}

export async function seek(position: number): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            throttledRemoteCommand(targetId, 'seek', { position }, 100);
        }
        return;
    }

    try {
        const dur = get(duration);
        const targetSecs = position * dur;
        let didSeek = false;

        if (get(activeBackend) === 'html5') {
            html5Seek(position);
            didSeek = true;
        } else if (get(activeBackend) === 'native') {
            await nativeAudioSeek(position);
            if (get(isPlaying)) {
                _startReckoning(targetSecs);
            } else {
                _stopReckoning(targetSecs);
                currentTime.set(targetSecs);
            }
            didSeek = true;
        }

        if (didSeek) {
            updateMediaSessionPosition();
            updateSmtcPlaybackState(get(isPlaying) ? 'playing' : 'paused');
            broadcastState(true);
            pluginEvents.emit('seeked', { currentTime: targetSecs, duration: dur });
        }
    } catch (err) {
        console.error('[Player] Seek failed:', err);
    }
}

export async function setVolume(sliderValue: number): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            throttledRemoteCommand(targetId, 'volume', { volume: sliderValue }, 100);
        }
        return;
    }

    volume.set(sliderValue);
    const vol = sliderToAudioVolume(sliderValue);

    try {
        html5SetVolume(vol);
        if (_nativeAudioUsed) {
            await nativeAudioSetVolume(vol);
        }
    } catch (err) {
        console.error('[Player] Volume set failed:', err);
    }
    broadcastState(true);
}

export function toggleShuffle(): void {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'shuffle', { shuffle: !get(shuffle) });
        }
        return;
    }

    shuffle.update(s => {
        const newState = !s;

        if (newState) {
            const q = get(queue);
            const currentIdx = get(queueIndex);
            const indices = q.map((_, i) => i);
            const shuffled = shuffleArray(indices);

            console.log('Regenerating shuffle in toggleShuffle');
            shuffledIndices.set(shuffled);

            const ptr = shuffled.indexOf(currentIdx);
            shuffledIndex.set(ptr !== -1 ? ptr : 0);
        }

        return newState;
    });
    broadcastState(true);
}

export function cycleRepeat(): void {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            const r = get(repeat);
            const next = r === 'none' ? 'all' : r === 'all' ? 'one' : 'none';
            sendRemoteCommand(targetId, 'repeat', { repeat: next });
        }
        return;
    }

    repeat.update(r => {
        const next = r === 'none' ? 'all' : r === 'all' ? 'one' : 'none';
        if (get(activeBackend) === 'native') {
            nativeAudioSetRepeatOne(next === 'one').catch(console.error);
        }
        return next;
    });
    broadcastState(true);
}

export function playFromQueue(index: number): void {
    const q = get(queue);
    const currentIdx = get(queueIndex);
    const userCount = get(userQueueCount);

    if (index >= 0 && index < q.length) {
        const userQueueEnd = currentIdx + 1 + userCount;
        if (index > currentIdx && index <= userQueueEnd) {
            const skipped = index - currentIdx;
            userQueueCount.update(c => Math.max(0, c - skipped));
        } else if (index > userQueueEnd) {
            userQueueCount.set(0);
        }

        queueIndex.set(index);
        playTrack(q[index]);

        if (get(shuffle)) {
            const ptr = get(shuffledIndices).indexOf(index);
            if (ptr !== -1) {
                shuffledIndex.set(ptr);
            }
        }
    }
}

// ─── Track-end handlers ───────────────────────────────────────────────────────

function _scrobblePrev(track: Track, durationPlayed: number): void {
    const trackDuration = track.duration ?? 0;
    if (get(appSettings).listenBrainzEnabled && trackDuration > 0) {
        const threshold = Math.min(Math.floor(trackDuration / 2), 240);
        if (durationPlayed >= threshold) {
            submitListenbrainzListen(
                track.artist ?? 'Unknown Artist',
                track.title ?? 'Unknown',
                track.album,
                track.duration,
                false,
            ).catch(e => console.warn('[ListenBrainz] Scrobble failed:', e));
        }
    }
}

export function handleTrackEnd(): void {
    const track = get(currentTrack);
    if (track && _playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - _playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(track.id, track.album_id ?? null, durationPlayed);
            _scrobblePrev(track, durationPlayed);
        }
        _playStartTime = 0;
    }

    if (get(repeat) === 'one' && track) {
        console.log('[Player] Repeat one: restarting current track');
        playTrack(track).catch(console.error);
        return;
    }

    nextTrack();
}

export function handleGaplessAdvance(): void {
    const q = get(queue);

    const prevTrack = get(currentTrack);
    if (prevTrack && _playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - _playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(prevTrack.id, prevTrack.album_id ?? null, durationPlayed);
            _scrobblePrev(prevTrack, durationPlayed);
        }
    }
    _playStartTime = Date.now();

    const idx = _advanceQueueIndex();
    if (idx === null) {
        handleTrackEnd();
        return;
    }

    queueIndex.set(idx);
    const nextTrackObj = q[idx];
    if (!nextTrackObj) return;

    _advanceUiToTrack(nextTrackObj);
}

async function _advanceUiToTrack(track: Track): Promise<void> {
    const previousTrackObj = get(currentTrack);

    const fullTrack = await getFullTrack(track.id, true);
    const trackForPlugins = fullTrack || track;

    resetCrossfadeFlags();
    currentTrack.set(trackForPlugins);
    currentTime.set(0);
    duration.set(track.duration || 0);
    isPlaying.set(true);

    if (get(activeBackend) === 'native') {
        _startReckoning(0);
    }

    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack: previousTrackObj });
    pluginEvents.emit('queueChange', { queue: get(queue), index: get(queueIndex) });

    await updateMediaSessionMetadata(trackForPlugins);
    updateMediaSessionPlaybackState('playing');
    updateMediaSessionPosition();
    await updateSmtcMetadata(trackForPlugins).catch(e => console.warn('[Player] SMTC metadata update failed:', e));
    updateSmtcPlaybackState('playing');
    broadcastState(true);

    _schedulePreload();
    _scheduleHtml5Preload();

    if (get(appSettings).listenBrainzEnabled) {
        submitListenbrainzListen(
            track.artist ?? 'Unknown Artist',
            track.title ?? 'Unknown',
            track.album,
            track.duration,
            true,
        ).catch(e => console.warn('[ListenBrainz] Now-playing failed:', e));
    }
}

// ─── Gapless preload ──────────────────────────────────────────────────────────

export function _schedulePreload(): void {
    if (get(activeBackend) !== 'native') return;

    const q = get(queue);
    const nextIdx = _advanceQueueIndex(true);

    if (nextIdx === null || nextIdx >= q.length) return;

    const nextTrackObj = q[nextIdx];
    if (!nextTrackObj || isStreaming(nextTrackObj)) return;

    const nextPath = nextTrackObj.local_src || nextTrackObj.path;
    if (!nextPath) return;

    setNativePreloadScheduled(true);
    nativeAudioPreload(nextPath, nextTrackObj.id, (nextTrackObj as any).replay_gain_db ?? null, get(appSettings).crossfadeSeconds).catch(e => {
        setNativePreloadScheduled(false);
        console.warn('[Player] Preload failed (non-fatal):', e);
    });
}

async function _scheduleHtml5Preload(): Promise<void> {
    if (get(activeBackend) !== 'html5') return;

    const q = get(queue);
    const nextIdx = _advanceQueueIndex(true);

    if (nextIdx === null || nextIdx >= q.length) return;

    const nextTrackObj = q[nextIdx];
    if (!nextTrackObj) return;

    let audioPath = nextTrackObj.local_src || nextTrackObj.path;

    // Resolve server tracks
    if (nextTrackObj.source_type === 'server' && !nextTrackObj.local_src) {
        try {
            audioPath = await audioGetStreamUrl(audioPath, nextTrackObj.id);
        } catch (err) {
            console.error('[Player] Preload path resolution failed:', err);
            return;
        }
    }

    if (!audioPath && (nextTrackObj as any).stream_url) {
        audioPath = (nextTrackObj as any).stream_url;
    }

    if (!audioPath && nextTrackObj.external_id && (nextTrackObj.external_id.startsWith('http://') || nextTrackObj.external_id.startsWith('https://'))) {
        audioPath = nextTrackObj.external_id;
    }

    if (!audioPath) return;

    const streaming = isStreaming(nextTrackObj) || !!(nextTrackObj as any).stream_url || audioPath.startsWith('http://') || audioPath.startsWith('https://');

    if (!streaming) {
        return;
    }

    const scheme = audioPath.includes('://') ? audioPath.split('://')[0] + '://' : '';
    const isCustomScheme = scheme && scheme !== 'http://' && scheme !== 'https://' && scheme !== 'file://' && scheme !== 'asset://' && scheme !== 'tauri://';

    if (isCustomScheme) {
        const runtime = pluginStore.getRuntime();
        if (runtime) {
            const sourceType = nextTrackObj.source_type;
            const externalId = nextTrackObj.external_id;
            if (sourceType && externalId) {
                try {
                    const fullTrack = await getFullTrack(nextTrackObj.id, true);
                    const trackForPlugins = fullTrack || nextTrackObj;
                    const resolved = await runtime.resolveStreamUrl(sourceType, externalId, { track: trackForPlugins });
                    if (resolved) {
                        audioPath = resolved;
                    }
                } catch (e) {
                    console.error('[Player] Failed to resolve custom scheme for preload:', e);
                }
            }
        }
    }

    console.log('[Player] Preloading next HTML5 track:', nextTrackObj.title, audioPath);
    html5Preload(audioPath, nextTrackObj.id, (nextTrackObj as any).replay_gain_db ?? null).catch(e => {
        console.warn('[Player] HTML5 Preload failed (non-fatal):', e);
    });
}

// Export for use in backend.ts native init
export function setPlayerNativeAudioUsed(val: boolean): void { _nativeAudioUsed = val; }
export function getPlayerNativeAudioUsed(): boolean { return _nativeAudioUsed; }
export function incrementPlayerNativeErrorCount(): number { return ++_nativeErrCount; }
export function resetPlayerNativeErrorCount(): void { _nativeErrCount = 0; }
export const PLAYER_NATIVE_ERROR_FALLBACK_THRESHOLD = 3;
