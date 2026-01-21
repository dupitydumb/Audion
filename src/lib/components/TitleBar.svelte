<script lang="ts">
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { goBack, goForward } from "$lib/stores/view";

    const appWindow = getCurrentWindow();

    function minimize() {
        appWindow.minimize();
    }

    function maximize() {
        appWindow.toggleMaximize();
    }

    function close() {
        appWindow.close();
    }
</script>

<div class="titlebar">
    <div class="left-controls">
        <!-- Menu Button (Triple Dot) -->
        <button type="button" class="nav-btn" aria-label="Menu">
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        </button>

        <!-- Navigation -->
        <div class="nav-group">
            <button class="nav-btn" on:click={goBack} aria-label="Go Back">
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <button
                class="nav-btn"
                on:click={goForward}
                aria-label="Go Forward"
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
    </div>

    <div class="drag-region" data-tauri-drag-region>
        <!-- Draggable area -->
    </div>

    <div class="window-controls">
        <button class="win-btn" on:click={minimize} aria-label="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"
                ><rect width="10" height="1" rx="0.5" /></svg
            >
        </button>
        <button class="win-btn" on:click={maximize} aria-label="Maximize">
            <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                ><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg
            >
        </button>
        <button class="win-btn close-btn" on:click={close} aria-label="Close">
            <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"><path d="M1 1l8 8M9 1L1 9" /></svg
            >
        </button>
    </div>
</div>

<style>
    .titlebar {
        height: 32px;
        background: var(--bg-base);
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 50; /* Ensure it's above other content but below high priority overlays if any */
        user-select: none;
        -webkit-user-select: none;
        border-bottom: 1px solid var(--border-color);
    }

    .left-controls {
        display: flex;
        align-items: center;
        padding-left: 8px;
        height: 100%;
        z-index: 51; /* Button layer */
    }

    .nav-group {
        display: flex;
        align-items: center;
        margin-left: 4px;
    }

    .nav-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
    }

    .nav-btn:hover {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .drag-region {
        flex-grow: 1;
        height: 100%;
        /* No visual content, just acts as a spacer and drag handle */
    }

    .window-controls {
        display: flex;
        height: 100%;
        z-index: 51; /* Button layer */
    }

    .win-btn {
        width: 46px;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        cursor: pointer;
        transition:
            background-color 0.2s,
            color 0.2s;
    }

    .win-btn:hover {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .close-btn:hover {
        background-color: #e81123;
        color: white;
    }
</style>
