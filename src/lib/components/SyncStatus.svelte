<script lang="ts">
    import {
        authState,
        syncStatus,
        syncProgress,
        isLoggedIn,
        isSyncing,
        triggerSync,
        showLoginModal,
    } from "$lib/stores/sync";
    import Icon from "$lib/components/Icon.svelte";
    import { _, locale } from "svelte-i18n";

    function handleClick() {
        if ($isLoggedIn) {
            triggerSync();
        } else {
            showLoginModal.set(true);
        }
    }

    // Format the last sync time as relative (e.g., "2m ago")
    function formatLastSync(
        timestamp: string | null,
        currentLocale: string | null | undefined,
        t: typeof $_,
    ): string {
        if (!timestamp) return t('syncStatus.never');

        const date = new Date(timestamp);
        const seconds = Math.floor(date.getTime() / 1000);
        if (isNaN(seconds)) return t('syncStatus.never');

        const now = Math.floor(Date.now() / 1000);
        const diff = now - seconds;

        if (diff < 60) return t('syncStatus.justNow');
        if (diff < 3600) return t('syncStatus.minutesAgo', { values: { minutes: Math.floor(diff / 60) } });
        if (diff < 86400) return t('syncStatus.hoursAgo', { values: { hours: Math.floor(diff / 3600) } });

        return new Intl.DateTimeFormat(currentLocale || undefined, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }).format(date);
    }

    function formatSyncError(error: string | null): string {
        if (!error) return "";
        try {
            if (error.includes("{") && error.includes("}")) {
                const jsonStart = error.indexOf("{");
                const jsonEnd = error.lastIndexOf("}") + 1;
                const jsonStr = error.substring(jsonStart, jsonEnd);
                const parsed = JSON.parse(jsonStr);
                if (parsed.details) return parsed.details;
                if (parsed.error) return parsed.error;
            }
        } catch (e) { /* ignore */ }
        return error.replace(/Request failed: \d+ [^—]+ — /, "");
    }

    $: progressPercent =
        $syncProgress.total > 0
            ? Math.round(($syncProgress.current / $syncProgress.total) * 100)
            : 0;

    $: lastSyncLabel = formatLastSync($syncStatus.last_sync_at, $locale, $_);

    let statusTitle = "";
    $: {
        if (!$isLoggedIn) {
            statusTitle = $_('syncStatus.signInToSync');
        } else if ($isSyncing) {
            statusTitle = $syncProgress.message || $_('syncOverlay.synchronizing');
        } else {
            const parts = [
                $_('syncStatus.lastSynced', { values: { time: lastSyncLabel } }),
            ];
            if ($syncStatus.pending_changes > 0) {
                parts.push(
                    $_('syncStatus.pendingCount', {
                        values: { count: $syncStatus.pending_changes },
                    }),
                );
            }
            if ($syncStatus.last_error) {
                parts.push(formatSyncError($syncStatus.last_error));
            }
            statusTitle = parts.join(" • ");
        }
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="sync-status"
    class:logged-in={$isLoggedIn}
    class:syncing={$isSyncing}
    class:has-error={$syncStatus.last_error}
    on:click={handleClick}
    title={statusTitle}
>
    {#if $isLoggedIn}
        {#if $isSyncing}
            <!-- Spinning sync icon + progress text -->
            <Icon name="sync" size={16} className="icon spinning" />
            {#if $syncProgress.message}
                <span class="progress-text">
                    {#if $syncProgress.total > 0}
                        {progressPercent}%
                    {:else}
                        …
                    {/if}
                </span>
            {/if}
        {:else if $syncStatus.last_error}
            <!-- Error icon -->
            <Icon name="alert-circle" size={16} className="icon error" />
        {:else if $syncStatus.pending_changes > 0}
            <!-- Pending changes dot -->
            <Icon name="sync" size={16} className="icon pending" />
            <span class="badge">{$syncStatus.pending_changes}</span>
        {:else}
            <!-- Synced (check) icon -->
            <Icon name="check-circle" size={16} className="icon synced" />
        {/if}
    {:else}
        <!-- Cloud off icon (not logged in) -->
        <Icon name="cloud-off" size={16} className="icon cloud-off" />
    {/if}
</div>

<style>
    .sync-status {
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        cursor: pointer;
        padding: 6px;
        border-radius: 8px;
        transition: all var(--transition-fast);
        background: transparent;
    }

    .sync-status:hover {
        background: var(--bg-highlight);
    }

    .icon {
        width: 15px; /* Slightly smaller for elegance */
        height: 15px;
        color: var(--text-subdued);
        transition: all var(--transition-fast);
    }

    .sync-status:hover .icon {
        color: var(--text-secondary);
    }

    .icon.synced {
        color: var(--accent-primary);
    }

    .icon.error {
        color: var(--error-color);
    }

    .icon.pending {
        color: var(--accent-warning, #ffae42);
    }

    .icon.cloud-off {
        color: var(--text-subdued);
    }

    .spinning {
        animation: spin 1s linear infinite, glow-pulse 2s ease-in-out infinite;
        color: var(--accent-primary) !important;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    @keyframes glow-pulse {
        0%, 100% { filter: drop-shadow(0 0 1px var(--accent-primary)); opacity: 0.8; }
        50% { filter: drop-shadow(0 0 4px var(--accent-primary)); opacity: 1; }
    }

    .badge {
        position: absolute;
        top: 0px;
        right: 0px;
        background: var(--accent-warning, #ffae42);
        color: #000;
        font-size: 8px;
        font-weight: 800;
        min-width: 13px;
        height: 13px;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 3px;
        line-height: 1;
        box-shadow: 0 0 0 2px var(--bg-base);
    }

    .progress-text {
        font-size: 10px;
        font-weight: var(--font-weight-bold);
        color: var(--accent-primary);
        margin-left: 6px;
        white-space: nowrap;
        min-width: 28px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
    }
</style>
