<script lang="ts">
    import { syncProgress, isSyncing } from "$lib/stores/sync";
    import { fade, fly } from "svelte/transition";
    import { isMobile } from "$lib/stores/mobile";

    $: visible = $isSyncing && $syncProgress.phase !== "";
    $: progressPercent =
        $syncProgress.total > 0
            ? Math.round(($syncProgress.current / $syncProgress.total) * 100)
            : 0;

    function getPhaseLabel(phase: string) {
        switch (phase) {
            case "push":
                return "Pushing metadata...";
            case "pull":
                return "Pulling metadata...";
            case "sync":
                return "Synchronizing...";
            case "auth":
                return "Authenticating...";
            default:
                return "Cloud Syncing...";
        }
    }
</script>

{#if visible}
    <div
        class="sync-toast"
        class:mobile={$isMobile}
        in:fly={{ y: 20, duration: 400 }}
        out:fade={{ duration: 200 }}
    >
        <div class="sync-card">
            <div class="sync-main">
                <div class="loader">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" stroke-opacity="0.2" stroke-width="3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke-width="3" stroke-linecap="round" />
                    </svg>
                </div>
                
                <div class="content">
                    <span class="label">{getPhaseLabel($syncProgress.phase)}</span>
                    {#if $syncProgress.total > 0}
                        <div class="progress-wrapper">
                            <div class="progress-bar">
                                <div class="fill" style="width: {progressPercent}%"></div>
                            </div>
                            <span class="percent">{progressPercent}%</span>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .sync-toast {
        position: fixed;
        bottom: calc(var(--player-height, 96px) + 24px);
        left: 24px;
        z-index: 9999;
        pointer-events: none;
    }

    .sync-toast.mobile {
        bottom: calc(var(--player-height, 64px) + 72px);
        left: 16px;
        right: 16px;
    }

    .sync-card {
        background: rgba(24, 24, 24, 0.8);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: var(--radius-lg, 12px);
        padding: 12px 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        min-width: 240px;
        max-width: 320px;
        pointer-events: auto;
    }

    .sync-toast.mobile .sync-card {
        max-width: none;
    }

    .sync-main {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    .loader {
        width: 24px;
        height: 24px;
        color: var(--accent-primary, #1DB954);
        animation: spin 1s linear infinite;
        flex-shrink: 0;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .label {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-primary, #ffffff);
        letter-spacing: -0.01em;
    }

    .progress-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .progress-bar {
        flex: 1;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
    }

    .fill {
        height: 100%;
        background: var(--accent-primary, #1DB954);
        border-radius: 2px;
        transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 0 8px var(--accent-subtle);
    }

    .percent {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--text-secondary, #b3b3b3);
        font-variant-numeric: tabular-nums;
        min-width: 32px;
        text-align: right;
    }
</style>
