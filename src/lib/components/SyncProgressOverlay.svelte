<script lang="ts">
    import { syncProgress, isSyncing } from "$lib/stores/sync";
    import { fade, fly } from "svelte/transition";
    import { isMobile } from "$lib/stores/mobile";
    import { _ } from "svelte-i18n";
    import Icon from "$lib/components/Icon.svelte";

    $: visible = $isSyncing && $syncProgress.phase !== "";
    $: progressPercent =
        $syncProgress.total > 0
            ? Math.round(($syncProgress.current / $syncProgress.total) * 100)
            : 0;

    function getPhaseLabel(phase: string) {
        switch (phase) {
            case "push":
                return $_('syncOverlay.pushing');
            case "pull":
                return $_('syncOverlay.pulling');
            case "sync":
                return $_('syncOverlay.synchronizing');
            case "auth":
                return $_('syncOverlay.authenticating');
            default:
                return $_('syncOverlay.cloudSyncing');
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
                    <Icon name="loader" size={24} />
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
        z-index: var(--z-toast, 1100);
        pointer-events: none;
    }

    .sync-toast.mobile {
        bottom: calc(var(--bottom-chrome-inset, 64px) + 12px);
        left: calc(16px + var(--safe-area-left, 0px));
        right: calc(16px + var(--safe-area-right, 0px));
    }

    .sync-card {
        background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg, 12px);
        padding: 12px 16px;
        box-shadow: var(--shadow-lg);
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
        color: var(--accent-primary);
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
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
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
        background: var(--surface-subtle-hover);
        border-radius: 2px;
        overflow: hidden;
    }

    .fill {
        height: 100%;
        background: var(--accent-primary);
        border-radius: 2px;
        transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 0 8px var(--accent-subtle);
    }

    .percent {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
        min-width: 32px;
        text-align: right;
    }
</style>
