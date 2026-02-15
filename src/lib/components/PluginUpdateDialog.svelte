<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        pluginStore,
        type PluginUpdateInfo,
    } from "$lib/stores/plugin-store";

    const dispatch = createEventDispatcher();

    function close() {
        dispatch("close");
    }

    async function handleUpdateAll() {
        await pluginStore.applyPendingUpdates();
        close();
    }

    function handleSkip() {
        pluginStore.clearPendingUpdates();
        close();
    }
</script>

<div class="modal-overlay" on:click={close} role="presentation">
    <div class="modal-content" on:click|stopPropagation role="presentation">
        <div class="modal-header">
            <h2>Plugin Updates Available</h2>
            <button class="close-btn" on:click={close}>
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="24"
                    height="24"
                >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>

        <div class="modal-body">
            <p class="description">
                The following plugins have updates available. Would you like to
                update them now?
            </p>

            <div class="update-list">
                {#each $pluginStore.pendingUpdates as update}
                    <div class="update-item">
                        <div class="update-info">
                            <span class="plugin-name">{update.name}</span>
                            <div class="version-info">
                                <span class="old-version"
                                    >v{update.current_version}</span
                                >
                                <span class="arrow">→</span>
                                <span class="new-version"
                                    >v{update.new_version}</span
                                >
                            </div>
                        </div>
                        <a
                            href={update.repo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="changelog-link"
                        >
                            View Repository
                        </a>
                    </div>
                {/each}
            </div>
        </div>

        <div class="modal-footer">
            <button class="btn-secondary" on:click={handleSkip}>
                Skip for now
            </button>
            <button class="btn-primary" on:click={handleUpdateAll}>
                Update All
            </button>
        </div>
    </div>
</div>

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(4px);
        padding: var(--spacing-md);
    }

    .modal-content {
        background-color: var(--bg-surface);
        width: 100%;
        max-width: 500px;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        box-shadow:
            0 20px 25px -5px rgba(0, 0, 0, 0.1),
            0 10px 10px -5px rgba(0, 0, 0, 0.04);
        overflow: hidden;
    }

    .modal-header {
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: var(--bg-surface);
    }

    .modal-header h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-subdued);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: all 0.2s;
    }

    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .modal-body {
        padding: var(--spacing-lg);
        overflow-y: auto;
        max-height: 60vh;
        overscroll-behavior-y: contain
    }

    .description {
        color: var(--text-secondary);
        margin-top: 0;
        margin-bottom: var(--spacing-lg);
        font-size: 0.9375rem;
    }

    .update-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .update-item {
        background-color: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .update-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .plugin-name {
        font-weight: 600;
        color: var(--text-primary);
        font-size: 0.9375rem;
    }

    .version-info {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8125rem;
    }

    .old-version {
        color: var(--text-subdued);
    }

    .arrow {
        color: var(--text-subdued);
    }

    .new-version {
        color: #22c55e;
        font-weight: 600;
    }

    .changelog-link {
        color: var(--accent-primary);
        font-size: 0.8125rem;
        text-decoration: none;
    }

    .changelog-link:hover {
        text-decoration: underline;
    }

    .modal-footer {
        padding: var(--spacing-lg);
        border-top: 1px solid var(--border-color);
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-md);
        background-color: var(--bg-surface);
    }

    .btn-primary,
    .btn-secondary {
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        font-weight: 500;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .btn-primary {
        background-color: var(--accent-primary);
        color: white;
        border: none;
    }

    .btn-primary:hover {
        opacity: 0.9;
    }

    .btn-secondary {
        background-color: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
        background-color: rgba(255, 255, 255, 0.05);
        color: var(--text-primary);
    }
</style>
