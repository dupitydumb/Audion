<script lang="ts">
    import { flip } from "svelte/animate";
    import { FLIP_MOTION } from "$lib/motion";
    import { toasts } from "$lib/stores/toast";
    import Toast from "./Toast.svelte";
</script>

<div class="toast-container">
    {#each $toasts as toast (toast.id)}
        <div class="toast-slot" animate:flip={FLIP_MOTION}>
            <Toast {toast} />
        </div>
    {/each}
</div>

<style>
    .toast-container {
        position: fixed;
        bottom: calc(var(--player-height, 96px) + var(--spacing-md));
        left: 50%;
        transform: translateX(-50%);
        z-index: var(--z-toast, 1100);
        display: flex;
        flex-direction: column-reverse;
        align-items: center;
        gap: var(--spacing-sm);
        pointer-events: none;
    }

    /* Mobile: above bottom chrome (nav + mini-player when active) + safe area */
    :global(html.layout-mobile) .toast-container {
        bottom: calc(var(--bottom-chrome-inset, 64px) + 12px);
        width: 100%;
        padding: 0 calc(var(--spacing-md) + var(--safe-area-right, 0px)) 0 calc(var(--spacing-md) + var(--safe-area-left, 0px));
    }
</style>
