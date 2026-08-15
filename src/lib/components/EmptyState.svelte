<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { _ } from "svelte-i18n";

    export let icon: string = "music"; // icon name: "music" | "search" | "folder" | "playlist"
    export let title: string = "";
    export let description: string = "";
    export let actionLabel: string = "";
    export let onAction: (() => void) | null = null;

    const dispatch = createEventDispatcher();

    const ICONS: Record<string, string> = {
        music: "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
        search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
        folder: "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z",
        playlist: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
    };
</script>

<div class="empty-state-wrapper">
    <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
            <path d={ICONS[icon] || ICONS.music} />
        </svg>
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
