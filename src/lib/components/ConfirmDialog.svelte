<script lang="ts">
    import {
        confirmDialogStore,
        closeConfirmDialog,
    } from "$lib/stores/dialogs";
    import { fade, scale } from "svelte/transition";
    import { onMount } from "svelte";

    let dialogElement: HTMLDivElement;

    function handleKeydown(e: KeyboardEvent) {
        if (!$confirmDialogStore.visible) return;

        if (e.key === "Escape") {
            closeConfirmDialog(false);
        } else if (e.key === "Enter") {
            // Only confirm on Enter if it's not a danger action context, or we can just require clicks for safety.
            // For now, let's allow Enter for convenience but user can modify if needed.
            closeConfirmDialog(true);
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $confirmDialogStore.visible}
    <div
        class="dialog-overlay"
        transition:fade={{ duration: 150 }}
        on:click={() => closeConfirmDialog(false)}
    >
        <div
            class="dialog-box"
            transition:scale={{ duration: 200, start: 0.95 }}
            on:click|stopPropagation
            bind:this={dialogElement}
            role="dialog"
            aria-modal="true"
        >
            <h3 class="dialog-title">{$confirmDialogStore.title}</h3>
            <p class="dialog-message">{$confirmDialogStore.message}</p>

            <div class="dialog-actions">
                <button
                    class="btn-secondary"
                    on:click={() => closeConfirmDialog(false)}
                >
                    {$confirmDialogStore.cancelLabel}
                </button>
                <button
                    class="btn-primary"
                    class:danger={$confirmDialogStore.danger}
                    on:click={() => closeConfirmDialog(true)}
                    autofocus
                >
                    {$confirmDialogStore.confirmLabel}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(4px);
    }

    .dialog-box {
        background-color: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: var(--spacing-lg);
        width: 100%;
        max-width: 400px;
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
    }

    .dialog-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .dialog-message {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.5;
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
    }

    .btn-primary.danger {
        background-color: var(--error-color);
        color: white;
    }

    .btn-primary.danger:hover {
        background-color: #d64250; /* Slightly darker shade */
    }
</style>
