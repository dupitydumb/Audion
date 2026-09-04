<script lang="ts">
    import { toasts } from "$lib/stores/toast";
    import Toast from "./Toast.svelte";
</script>

<div class="toast-container">
    {#each $toasts as toast (toast.id)}
        <Toast {toast} />
    {/each}
</div>

<style>
    .toast-container {
        position: fixed;
        bottom: calc(var(--player-height, 96px) + var(--spacing-md));
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        flex-direction: column-reverse;
        align-items: center;
        gap: var(--spacing-sm);
        pointer-events: none;
    }

    /* Mobile: above mini-player + bottom nav + safe area */
    :global(html.layout-mobile) .toast-container {
        /* mini-player ~64px + bottom-nav ~60px + safe area + spacing */
        bottom: calc(64px + 60px + env(safe-area-inset-bottom, 0px) + var(--spacing-sm));
        width: 100%;
        padding: 0 var(--spacing-md);
    }
</style>
