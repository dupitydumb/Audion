<script lang="ts">
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import type { Toast } from "$lib/stores/toast";
    import { toasts } from "$lib/stores/toast";

    export let toast: Toast;

    function close() {
        toasts.remove(toast.id);
    }
</script>

<div
    class="toast {toast.type}"
    in:fly={{ y: 20, duration: 300, opacity: 0 }}
    out:fade={{ duration: 200 }}
>
    <div class="content">
        {#if toast.type === "error"}
            <span class="icon error">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
            </span>
        {:else if toast.type === "success"}
            <span class="icon success">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </span>
        {:else if toast.type === "warning"}
            <span class="icon warning">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    ></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
            </span>
        {:else}
            <span class="icon info">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
            </span>
        {/if}
        <span class="message">{toast.message}</span>
    </div>
    <button class="close-btn" on:click={close} aria-label="Close notification">
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
    </button>
</div>

<style>
    .toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 320px;
        background: var(--bg-highlight); /* Fallback */
        background: rgba(30, 30, 30, 0.95);
        border: 1px solid var(--border-primary);
        color: var(--text-primary);
        padding: 0.75rem 1rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        margin-bottom: 0.75rem;
        backdrop-filter: blur(10px);
        pointer-events: auto;
    }

    .toast.error {
        border-left: 4px solid var(--accent-error);
    }

    .toast.success {
        border-left: 4px solid var(--accent-success);
    }

    .toast.warning {
        border-left: 4px solid var(--accent-warning);
    }

    .toast.info {
        border-left: 4px solid var(--accent-info);
    }

    .content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 1;
        overflow: hidden;
    }

    .message {
        font-size: 0.9rem;
        line-height: 1.4;
        word-break: break-word;
    }

    .icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .icon svg {
        width: 20px;
        height: 20px;
    }

    .icon.error {
        color: var(--accent-error);
    }
    .icon.success {
        color: var(--accent-success);
    }
    .icon.warning {
        color: var(--accent-warning);
    }
    .icon.info {
        color: var(--accent-info);
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px;
        margin-left: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        opacity: 0.7;
        transition:
            opacity 0.2s,
            background-color 0.2s;
    }

    .close-btn:hover {
        opacity: 1;
        background-color: var(--bg-hover);
    }

    .close-btn svg {
        width: 16px;
        height: 16px;
    }
</style>
