<script lang="ts">
    import { get } from "svelte/store";
    import { onMount, onDestroy } from "svelte";
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
    import { toggleLyrics, lyricsVisible } from "$lib/stores/lyrics";
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
        shortcutBindings,
        matchBindings,
        type ShortcutBinding,
    } from "$lib/stores/shortcuts";

    // Volume step (5%)
    const VOLUME_STEP = 0.05;

    // Seek steps in seconds
    const SEEK_SMALL = 5;
    const SEEK_LARGE = 30;

    // Track last volume for mute toggle
    let lastVolume = 0.7;
    let isMuted = false;

    // dynamically import the Tauri global-shortcut plugin
    let globalShortcutPlugin: typeof import("@tauri-apps/plugin-global-shortcut") | null = null;

    // track which globalStrings are currently registered so we can unregister
    // stale ones when bindings change
    let registeredGlobals = new Set<string>();

    async function loadPlugin() {
        try {
            globalShortcutPlugin = await import("@tauri-apps/plugin-global-shortcut");
        } catch {
            console.warn("[Shortcuts] global-shortcut plugin not available");
        }
    }

    // media keys are always registered globally . not user-rebindable
    const MEDIA_KEYS: Array<{ gs: string; action: string }> = [
        { gs: "MediaPlayPause",      action: "togglePlay"    },
        { gs: "MediaTrackNext",      action: "nextTrack"     },
        { gs: "MediaTrackPrevious",  action: "previousTrack" },
    ];

    async function syncGlobalShortcuts(bindings: ShortcutBinding[]) {
        if (!globalShortcutPlugin) return;

        const { register, unregister } = globalShortcutPlugin;

        // desired set: media keys (always) + user-enabled globals
        const desired = new Map<string, string>(); // globalString -> action
        for (const mk of MEDIA_KEYS) {
            desired.set(mk.gs, mk.action);
        }
        for (const b of bindings) {
            if (b.isGlobal && b.globalString) {
                desired.set(b.globalString, b.action);
            }
        }

        // unregister any that are no longer wanted
        for (const gs of registeredGlobals) {
            if (!desired.has(gs)) {
                try {
                    await unregister(gs);
                } catch (err) {
                    console.warn(`[Shortcuts] Failed to unregister global "${gs}":`, err);
                }
                registeredGlobals.delete(gs);
            }
        }

        // register new ones
        // use event.state guard for all globals to avoid double-fire on OSes that emit both Pressed and Released events
        for (const [gs, action] of desired) {
            if (registeredGlobals.has(gs)) continue;
            try {
                await register(gs, (event) => {
                    if (event.state === "Pressed") dispatch(action);
                });
                registeredGlobals.add(gs);
            } catch (err) {
                console.warn(`[Shortcuts] Failed to register global "${gs}" for "${action}":`, err);
                const failedBinding = get(shortcutBindings).find(
                    b => b.action === action && b.globalString === gs
                );
                if (failedBinding) {
                    shortcutBindings.markGlobalError(action, failedBinding.keyDisplay, String(err));
                }
            }
        }
    }

    let unsubscribeBindings: () => void;

    onMount(async () => {
        await loadPlugin();

        // re-sync global shortcuts whenever bindings change
        unsubscribeBindings = shortcutBindings.subscribe(bindings => {
            syncGlobalShortcuts(bindings);
        });
    });

    onDestroy(async () => {
        unsubscribeBindings?.();

        // unregister all globals on component teardown
        if (globalShortcutPlugin && registeredGlobals.size > 0) {
            const { unregister } = globalShortcutPlugin;
            for (const gs of registeredGlobals) {
                try { await unregister(gs); } catch { /* ignore */ }
            }
        }
    });

    function dispatch(action: string) {
        switch (action) {
            // Playback
            case "togglePlay":       togglePlay();                 break;
            case "nextTrack":        nextTrack();                  break;
            case "previousTrack":    previousTrack();              break;
            case "toggleShuffle":    toggleShuffle();              break;
            case "cycleRepeat":      cycleRepeat();                break;

            // Volume
            case "volumeUp":         adjustVolume(VOLUME_STEP);    break;
            case "volumeDown":       adjustVolume(-VOLUME_STEP);   break;
            case "toggleMute":       toggleMute();                 break;

            // Seeking
            case "seekForward5":     seekRelative(SEEK_SMALL);     break;
            case "seekBackward5":    seekRelative(-SEEK_SMALL);    break;
            case "seekForward30":    seekRelative(SEEK_LARGE);     break;
            case "seekBackward30":   seekRelative(-SEEK_LARGE);    break;

            // Navigation
            case "goToTracks":       goToTracks();                 break;
            case "goToAlbums":       goToAlbums();                 break;
            case "goToArtists":      goToArtists();                break;
            case "goToPlaylists":    goToPlaylists();              break;
            case "goToPlugins":      goToPlugins();                break;
            case "goToSettings":     goToSettings();               break;
            case "focusSearch":      focusSearchInput();           break;

            // UI
            case "toggleLyrics":     toggleLyrics();               break;
            case "toggleQueue":      toggleQueue();                 break;
            case "toggleFullscreen": toggleFullScreen();            break;
            case "closeOrClear":     handleEscape();               break;
            case "showHelp":         showShortcutsHelp();          break;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        // When the help/edit modal is open, only allow Escape
        if (get(isShortcutsHelpVisible)) {
            if (e.key === "Escape") {
                e.preventDefault();
                hideShortcutsHelp();
            }
            return;
        }

        // Skip shortcuts while typing in inputs, but still allow Escape to blur
        if (isInputElement(e.target)) {
            if (e.key === "Escape") {
                (e.target as HTMLElement).blur();
            }
            return;
        }

        const bindings = get(shortcutBindings);
        const matched  = matchBindings(e, bindings);

        if (matched.length === 0) return;

        // filter out actions whose binding is currently registered as a global to avoid double firing
        const globalActions = new Set(
            bindings.filter(b => b.isGlobal && b.globalString).map(b => b.action)
        );
        const toDispatch = matched.filter(action => !globalActions.has(action));

        if (toDispatch.length === 0) return;

        e.preventDefault();
        for (const action of toDispatch) {
            dispatch(action);
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
        const total   = get(duration);
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
