<script lang="ts">
    import { syncStatus, syncProgress, isSyncing } from "$lib/stores/sync";
    import { fade, slide } from "svelte/transition";
    import { isMobile } from "$lib/stores/mobile";

    $: visible = $isSyncing && $syncProgress.phase !== "";
    $: progressPercent =
        $syncProgress.total > 0
            ? Math.round(($syncProgress.current / $syncProgress.total) * 100)
            : 0;

    function getPhaseLabel(phase: string) {
        switch (phase) {
            case "push":
                return "Uploading changes...";
            case "pull":
                return "Downloading changes...";
            case "sync":
                return "Synchronizing...";
            case "auth":
                return "Authenticating...";
            default:
                return "Syncing...";
        }
    }
</script>

{#if visible}
    <div
        class="sync-overlay"
        class:mobile={$isMobile}
        transition:slide={{ duration: 300 }}
    >
        <div class="sync-content">
            <div class="sync-info">
                <span class="sync-icon">🔄</span>
                <div class="sync-text">
                    <span class="phase"
                        >{getPhaseLabel($syncProgress.phase)}</span
                    >
                    {#if $syncProgress.message}
                        <span class="message">{$syncProgress.message}</span>
                    {/if}
                </div>
                {#if $syncProgress.total > 0}
                    <span class="percentage">{progressPercent}%</span>
                {/if}
            </div>

            {#if $syncProgress.total > 0}
                <div class="progress-bar-container">
                    <div
                        class="progress-bar-fill"
                        style="width: {progressPercent}%"
                    ></div>
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    .sync-overlay {
        position: fixed;
        top: 48px; /* Below TitleBar */
        left: 0;
        right: 0;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        z-index: 1000;
        padding: 10px 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .sync-overlay.mobile {
        top: 0; /* No TitleBar on mobile usually, or it's different */
        padding: 12px 20px;
        background: var(--bg-color, #121212);
    }

    .sync-content {
        max-width: 800px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .sync-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .sync-icon {
        font-size: 1.2rem;
        animation: spin 2s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .sync-text {
        display: flex;
        flex-direction: column;
        flex: 1;
    }

    .phase {
        font-size: 0.9rem;
        font-weight: 600;
        color: #fff;
    }

    .message {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .percentage {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--accent-color, #6366f1);
        font-variant-numeric: tabular-nums;
    }

    .progress-bar-container {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #6366f1, #a855f7);
        transition: width 0.3s ease-out;
        border-radius: 2px;
        box-shadow: 0 0 8px rgba(99, 102, 241, 0.5);
    }
</style>
