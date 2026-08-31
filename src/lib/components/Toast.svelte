<script lang="ts">
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
    in:fly={{ y: 40, duration: 350, opacity: 0 }}
    out:fade={{ duration: 200 }}
    role="alert"
>
    <div class="icon-badge">
        {#if toast.type === "error"}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
        {:else if toast.type === "success"}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
        {:else if toast.type === "warning"}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
            </svg>
        {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
        {/if}
    </div>
    <span class="message">{toast.message}</span>
    <button class="close-btn" on:click={close} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
    </button>
</div>

<style>
    .toast {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 280px;
        max-width: 420px;
        background-color: var(--bg-surface);
        color: var(--text-primary);
        padding: 10px 12px;
        border-radius: var(--radius-full);
        box-shadow: var(--shadow-lg);
        pointer-events: auto;
        border: 1px solid var(--border-color);
    }

    /* ── Type-specific tinted backgrounds ── */
    .toast.success {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
        color: var(--bg-base);
    }

    .toast.error {
        background-color: var(--accent-error, var(--error-color));
        border-color: var(--accent-error, var(--error-color));
        color: #fff;
    }

    .toast.warning {
        background-color: var(--accent-warning, #ffae42);
        border-color: var(--accent-warning, #ffae42);
        color: #1a1a1a;
    }

    .toast.info {
        background-color: var(--bg-surface);
        border-color: var(--border-color);
    }

    /* ── Icon badge ── */
    .icon-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-full);
        flex-shrink: 0;
        background-color: rgba(0, 0, 0, 0.15);
        color: inherit;
    }

    .toast.info .icon-badge {
        background-color: var(--accent-subtle);
        color: var(--accent-primary);
    }

    .toast.success .icon-badge {
        background-color: rgba(0, 0, 0, 0.2);
    }

    .toast.error .icon-badge {
        background-color: rgba(0, 0, 0, 0.2);
    }

    .toast.warning .icon-badge {
        background-color: rgba(0, 0, 0, 0.12);
    }

    /* ── Message ── */
    .message {
        flex: 1;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: inherit;
    }

    /* ── Close button ── */
    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
        border-radius: var(--radius-full);
        flex-shrink: 0;
        color: inherit;
        opacity: 0.6;
        transition: all var(--transition-fast);
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
    }

    .close-btn:hover {
        opacity: 1;
        background-color: rgba(0, 0, 0, 0.15);
    }

    .toast.info .close-btn:hover {
        background-color: var(--bg-highlight);
    }

    /* ── Mobile ── */
    :global(html.layout-mobile) .toast {
        min-width: 0;
        max-width: calc(100vw - 32px);
        width: auto;
        padding: 10px 14px;
    }

    :global(html.layout-mobile) .close-btn {
        width: 32px;
        height: 32px;
        min-width: 32px;
        min-height: 32px;
    }
</style>
