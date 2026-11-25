<script lang="ts">
    import { promptDialogStore, closePromptDialog } from "$lib/stores/dialogs";
    import { fade, scale } from "svelte/transition";
    import { onDestroy, tick } from "svelte";
    import { registerBackHandler } from "$lib/stores/mobile";

    let inputElement: HTMLInputElement;
    let unregisterBackHandler: (() => void) | null = null;

    $: if ($promptDialogStore.visible) {
        if (!unregisterBackHandler) {
            unregisterBackHandler = registerBackHandler(() => {
                closePromptDialog(null);
                return true;
            });
        }
    } else if (unregisterBackHandler) {
        unregisterBackHandler();
        unregisterBackHandler = null;
    }

    onDestroy(() => {
        if (unregisterBackHandler) {
            unregisterBackHandler();
            unregisterBackHandler = null;
        }
    });

    $: if ($promptDialogStore.visible) {
        focusInput();
    }

    async function focusInput() {
        await tick();
        if (inputElement) {
            inputElement.focus();
            inputElement.select();
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (!$promptDialogStore.visible) return;

        if (e.key === "Escape") {
            closePromptDialog(null);
        } else if (e.key === "Enter") {
            closePromptDialog($promptDialogStore.value);
        }
    }

    function handleConfirm() {
        closePromptDialog($promptDialogStore.value);
    }

    function handleCancel() {
        closePromptDialog(null);
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $promptDialogStore.visible}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="dialog-overlay"
        transition:fade={{ duration: 150 }}
        on:click={handleCancel}
    >
        <div
            class="dialog-box"
            transition:scale={{ duration: 200, start: 0.95 }}
            on:click|stopPropagation
            role="dialog"
            aria-modal="true"
            tabindex="-1"
        >
            <h3 class="dialog-title">{$promptDialogStore.title}</h3>
            <p class="dialog-message">{$promptDialogStore.message}</p>

            <div class="input-container">
                <input
                    type="text"
                    class="prompt-input"
                    bind:value={$promptDialogStore.value}
                    bind:this={inputElement}
                    placeholder={$promptDialogStore.placeholder}
                />
            </div>

            <div class="dialog-actions">
                <button class="btn-secondary" on:click={handleCancel}>
                    {$promptDialogStore.cancelLabel}
                </button>
                <button class="btn-primary" on:click={handleConfirm}>
                    {$promptDialogStore.confirmLabel}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .dialog-overlay {
        position: fixed;
        inset: 0;
        padding: calc(16px + var(--safe-area-top, 0px)) 16px calc(16px + var(--safe-area-bottom, 0px));
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--z-dialog, 5000);
        backdrop-filter: blur(4px);
    }

    .dialog-box {
        background-color: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: var(--spacing-lg);
        width: 100%;
        max-width: 400px;
        max-height: 90dvh;
        overflow-y: auto;
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        animation: springScaleIn 0.28s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .dialog-title {
        font-size: 1.125rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
    }

    .dialog-message {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        margin: 0;
        line-height: var(--line-height-normal);
    }

    .input-container {
        width: 100%;
    }

    .prompt-input {
        width: 100%;
        background-color: var(--bg-surface, var(--bg-base));
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        color: var(--text-primary);
        font-size: 0.9375rem;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
    }

    .prompt-input:focus {
        border-color: var(--accent-primary);
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
    }

    :global(html.layout-mobile) .prompt-input,
    :global(html.layout-mobile) .dialog-actions button {
        min-height: 44px;
    }
</style>
