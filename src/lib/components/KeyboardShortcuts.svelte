<script lang="ts">
    import { get } from "svelte/store";
    import {
        togglePlay,
        nextTrack,
        previousTrack,
        toggleShuffle,
        cycleRepeat,
        volume,
        setVolume,
        currentTime,
        duration,
        seek,
    } from "$lib/stores/player";
    import {
        goToTracks,
        goToAlbums,
        goToArtists,
        goToPlaylists,
        goToPlugins,
        goToSettings,
    } from "$lib/stores/view";
    import { toggleLyrics } from "$lib/stores/lyrics";
    import {
        toggleQueue,
        toggleFullScreen,
        isFullScreen,
        isQueueVisible,
    } from "$lib/stores/ui";
    import {
        isInputElement,
        showShortcutsHelp,
        isShortcutsHelpVisible,
        hideShortcutsHelp,
    } from "$lib/stores/shortcuts";
    import { lyricsVisible } from "$lib/stores/lyrics";

    // Volume step (5%)
    const VOLUME_STEP = 0.05;

    // Seek steps in seconds
    const SEEK_SMALL = 5;
    const SEEK_LARGE = 30;

    // Track last volume for mute toggle
    let lastVolume = 0.7;
    let isMuted = false;

    function handleKeydown(e: KeyboardEvent) {
        // Check if shortcuts help is open - only allow Escape
        if (get(isShortcutsHelpVisible)) {
            if (e.key === "Escape") {
                e.preventDefault();
                hideShortcutsHelp();
            }
            return;
        }

        // Skip shortcuts when typing in inputs
        if (isInputElement(e.target)) {
            // Allow Escape to blur search input
            if (e.key === "Escape") {
                const target = e.target as HTMLElement;
                target.blur();
            }
            return;
        }

        const { key, ctrlKey, shiftKey } = e;

        // Handle Ctrl+key shortcuts first
        if (ctrlKey && !shiftKey) {
            switch (key.toLowerCase()) {
                case "f":
                    e.preventDefault();
                    focusSearchInput();
                    return;
                case "arrowright":
                    e.preventDefault();
                    seekRelative(SEEK_LARGE);
                    return;
                case "arrowleft":
                    e.preventDefault();
                    seekRelative(-SEEK_LARGE);
                    return;
            }
        }

        // Handle Shift+key shortcuts
        if (shiftKey && !ctrlKey) {
            switch (key) {
                case "ArrowRight":
                    e.preventDefault();
                    seekRelative(SEEK_SMALL);
                    return;
                case "ArrowLeft":
                    e.preventDefault();
                    seekRelative(-SEEK_SMALL);
                    return;
                case "?": // Shift+/ = ?
                    e.preventDefault();
                    showShortcutsHelp();
                    return;
            }
        }

        // Regular shortcuts (no modifiers)
        if (!ctrlKey && !shiftKey) {
            switch (key) {
                // Playback
                case " ":
                case "Spacebar":
                    e.preventDefault();
                    togglePlay();
                    return;
                case "ArrowRight":
                    e.preventDefault();
                    nextTrack();
                    return;
                case "ArrowLeft":
                    e.preventDefault();
                    previousTrack();
                    return;
                case "s":
                case "S":
                    e.preventDefault();
                    toggleShuffle();
                    return;
                case "r":
                case "R":
                    e.preventDefault();
                    cycleRepeat();
                    return;

                // Volume
                case "ArrowUp":
                    e.preventDefault();
                    adjustVolume(VOLUME_STEP);
                    return;
                case "ArrowDown":
                    e.preventDefault();
                    adjustVolume(-VOLUME_STEP);
                    return;
                case "m":
                case "M":
                    e.preventDefault();
                    toggleMute();
                    return;

                // Navigation
                case "1":
                    e.preventDefault();
                    goToTracks();
                    return;
                case "2":
                    e.preventDefault();
                    goToAlbums();
                    return;
                case "3":
                    e.preventDefault();
                    goToArtists();
                    return;
                case "4":
                    e.preventDefault();
                    goToPlaylists();
                    return;
                case "5":
                    e.preventDefault();
                    goToPlugins();
                    return;
                case "6":
                    e.preventDefault();
                    goToSettings();
                    return;
                case "/":
                    e.preventDefault();
                    focusSearchInput();
                    return;

                // UI Toggles
                case "l":
                case "L":
                    e.preventDefault();
                    toggleLyrics();
                    return;
                case "q":
                case "Q":
                    e.preventDefault();
                    toggleQueue();
                    return;
                case "f":
                case "F":
                    e.preventDefault();
                    toggleFullScreen();
                    return;
                case "F11":
                    e.preventDefault();
                    toggleFullScreen();
                    return;
                case "Escape":
                    e.preventDefault();
                    handleEscape();
                    return;
            }
        }
    }

    function adjustVolume(delta: number) {
        const currentVolume = get(volume);
        const newVolume = Math.max(0, Math.min(1, currentVolume + delta));
        setVolume(newVolume);
        if (newVolume > 0) {
            isMuted = false;
        }
    }

    function toggleMute() {
        const currentVolume = get(volume);
        if (isMuted || currentVolume === 0) {
            // Unmute - restore last volume
            setVolume(lastVolume > 0 ? lastVolume : 0.5);
            isMuted = false;
        } else {
            // Mute - save current volume and set to 0
            lastVolume = currentVolume;
            setVolume(0);
            isMuted = true;
        }
    }

    function seekRelative(seconds: number) {
        const current = get(currentTime);
        const total = get(duration);
        if (total <= 0) return;

        const newTime = Math.max(0, Math.min(total, current + seconds));
        const position = newTime / total;
        seek(position);
    }

    function focusSearchInput() {
        const searchInput = document.querySelector(
            ".search-input",
        ) as HTMLInputElement;
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }

    function handleEscape() {
        // Close panels in order of priority
        if (get(isFullScreen)) {
            toggleFullScreen();
            return;
        }
        if (get(lyricsVisible)) {
            toggleLyrics();
            return;
        }
        if (get(isQueueVisible)) {
            toggleQueue();
            return;
        }
        // Clear search if open
        const searchInput = document.querySelector(
            ".search-input",
        ) as HTMLInputElement;
        if (searchInput && searchInput.value) {
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />
