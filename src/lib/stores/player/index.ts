// Re-exports everything — all consumers import from here, zero import changes needed.

// Stores and types
export type { ActiveBackend, PlaybackContext } from './stores';
export {
    activeBackend, currentTrack, currentTrackId, currentTime, duration,
    isPlaying, queue, queueIndex, userQueueCount, volume, shuffle, repeat,
    shuffledIndices, shuffledIndex, playbackContext, currentPlaylistId,
    currentAlbumId, currentArtistName, pluginEvents,
    sliderToAudioVolume, audioVolumeToSlider, isStreaming,
} from './stores';

// Playback controls
export {
    playTrack, playTracks, playFromQueue,
    togglePlay, pause, resume,
    nextTrack, previousTrack,
    seek, setVolume,
    toggleShuffle, cycleRepeat,
} from './playback';

// Queue management
export {
    addToQueue, removeFromQueue, reorderQueue, clearUpcoming,
    isPlaylistPlaying, isAlbumPlaying, isArtistPlaying,
    progress,
} from './queue';

// Backend lifecycle
export { initAudioBackend, cleanupPlayer, shutdownPlayer, openAssociatedFile } from './backend';

// Remote
export { sendRemoteCommand, transferPlayback } from './remote';

// Media session / SMTC (consumed directly by persist.ts for restoring
// last-played-track state into the os media controls on startup
export { updateSmtcMetadata, updateSmtcPlaybackState, dispatchSmtcEvent } from './media-session';