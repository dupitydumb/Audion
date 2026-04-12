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

    function handleClick() {
        if ($isLoggedIn) {
            triggerSync();
        } else {
            showLoginModal.set(true);
        }
    }

    // Format the last sync time as relative (e.g., "2m ago")
    function formatLastSync(timestamp: string | null): string {
        if (!timestamp) return "Never";
        const seconds = parseInt(timestamp, 10);
        if (isNaN(seconds)) return "Never";

        const now = Math.floor(Date.now() / 1000);
        const diff = now - seconds;

        if (diff < 60) return "Just now";
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

        // Format as DD/MM/YYYY for older syncs
        const date = new Date(seconds * 1000);
        const dd = String(date.getDate()).padStart(2, "0");
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="sync-status"
    class:logged-in={$isLoggedIn}
    class:syncing={$isSyncing}
    class:has-error={$syncStatus.last_error}
    on:click={handleClick}
    title={$isLoggedIn
        ? $isSyncing
            ? $syncProgress.message || "Syncing..."
            : `Last synced: ${formatLastSync($syncStatus.last_sync_at)}${$syncStatus.pending_changes > 0 ? ` • ${$syncStatus.pending_changes} pending` : ""}${$syncStatus.last_error ? ` • ${formatSyncError($syncStatus.last_error)}` : ""}`
        : "Sign in to sync"}
>
    {#if $isLoggedIn}
        {#if $isSyncing}
            <!-- Spinning sync icon + progress text -->
            <svg
                class="icon spinning"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"
                />
            </svg>
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
            <svg
                class="icon error"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
        {:else if $syncStatus.pending_changes > 0}
            <!-- Pending changes dot -->
            <svg
                class="icon pending"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"
                />
            </svg>
            <span class="badge">{$syncStatus.pending_changes}</span>
        {:else}
            <!-- Synced (check) icon -->
            <svg
                class="icon synced"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
        {/if}
    {:else}
        <!-- Cloud off icon (not logged in) -->
        <svg
            class="icon cloud-off"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <path
                d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"
            />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
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
        font-weight: 700;
        color: var(--accent-primary);
        margin-left: 6px;
        white-space: nowrap;
        min-width: 28px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
    }
</style>
