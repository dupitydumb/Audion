<script lang="ts">
    import { fade, fly } from "svelte/transition";
    import type { Toast } from "$lib/stores/toast";
    import { toasts } from "$lib/stores/toast";
    import Icon from "$lib/components/Icon.svelte";

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
            <Icon name="alert-circle" size={16} />
        {:else if toast.type === "success"}
            <Icon name="check" size={16} />
        {:else if toast.type === "warning"}
            <Icon name="alert-triangle" size={16} />
        {:else}
            <Icon name="info" size={16} />
        {/if}
    </div>
    <span class="message">{toast.message}</span>
    <button class="close-btn" on:click={close} aria-label="Dismiss">
        <Icon name="x" size={16} />
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
