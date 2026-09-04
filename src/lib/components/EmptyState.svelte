<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { _ } from "svelte-i18n";
    import Icon from "$lib/components/Icon.svelte";

    export let icon: string = "music"; // icon name: "music" | "search" | "folder" | "playlist"
    export let title: string = "";
    export let description: string = "";
    export let actionLabel: string = "";
    export let onAction: (() => void) | null = null;

    const dispatch = createEventDispatcher();
</script>

<div class="empty-state-wrapper">
    <div class="empty-icon">
        <Icon name={icon || "music"} size={48} />
    </div>
    <h2 class="empty-title">
        {title || $_('emptyState.title')}
    </h2>
    {#if description}
        <p class="empty-description">{description}</p>
    {/if}
    {#if actionLabel && onAction}
        <button class="empty-action" on:click={() => { onAction(); dispatch('action'); }}>
            {actionLabel}
        </button>
    {/if}
</div>

<style>
    .empty-state-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: var(--spacing-xl);
        text-align: center;
        gap: var(--spacing-md);
        animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .empty-icon {
        width: 80px;
        height: 80px;
        border-radius: var(--radius-lg);
        background: var(--accent-subtle);
        color: var(--accent-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: var(--spacing-sm);
    }

    .empty-title {
        font-size: 1.5rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        letter-spacing: -0.01em;
    }

    .empty-description {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        max-width: 320px;
        line-height: var(--line-height-normal);
    }

    .empty-action {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-lg);
        border-radius: var(--radius-full);
        background: var(--accent-primary);
        color: var(--bg-base);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-base);
        border: none;
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .empty-action:hover {
        background: var(--accent-hover);
        transform: scale(1.03);
    }

    .empty-action:active {
        transform: scale(0.97);
    }
</style>
