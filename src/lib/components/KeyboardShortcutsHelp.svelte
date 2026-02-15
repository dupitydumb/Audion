<script lang="ts">
    import { fade, fly } from "svelte/transition";
    import {
        isShortcutsHelpVisible,
        hideShortcutsHelp,
        getShortcutsByCategory,
        categoryNames,
    } from "$lib/stores/shortcuts";

    $: shortcutsByCategory = getShortcutsByCategory();
</script>

{#if $isShortcutsHelpVisible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="shortcuts-overlay"
        transition:fade={{ duration: 200 }}
        on:click={hideShortcutsHelp}
        on:keydown={(e) => e.key === "Escape" && hideShortcutsHelp()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        tabindex="-1"
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="shortcuts-modal"
            transition:fly={{ y: 20, duration: 300 }}
            on:click|stopPropagation
            on:keydown|stopPropagation
        >
            <header class="modal-header">
                <h2>Keyboard Shortcuts</h2>
                <button
                    class="close-btn"
                    on:click={hideShortcutsHelp}
                    title="Close (Esc)"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="24"
                        height="24"
                    >
                        <path
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </svg>
                </button>
            </header>

            <div class="shortcuts-content">
                {#each Object.entries(shortcutsByCategory) as [category, shortcuts]}
                    {#if shortcuts.length > 0}
                        <section class="shortcut-category">
                            <h3 class="category-title">
                                {categoryNames[category]}
                            </h3>
                            <div class="shortcuts-list">
                                {#each shortcuts as shortcut}
                                    <div class="shortcut-item">
                                        <span class="shortcut-key">
                                            {#if shortcut.keyDisplay?.includes("+")}
                                                {#each shortcut.keyDisplay.split(" + ") as part, i}
                                                    {#if i > 0}<span
                                                            class="key-separator"
                                                            >+</span
                                                        >{/if}
                                                    <kbd>{part}</kbd>
                                                {/each}
                                            {:else}
                                                <kbd
                                                    >{shortcut.keyDisplay ||
                                                        shortcut.key}</kbd
                                                >
                                            {/if}
                                        </span>
                                        <span class="shortcut-description"
                                            >{shortcut.description}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        </section>
                    {/if}
                {/each}
            </div>

            <footer class="modal-footer">
                <p class="hint">Press <kbd>?</kbd> to toggle this help</p>
            </footer>
        </div>
    </div>
{/if}

<style>
    .shortcuts-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
    }

    .shortcuts-modal {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-lg);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        max-width: 700px;
        max-height: 80vh;
        width: 90%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--bg-highlight);
        flex-shrink: 0;
    }

    .modal-header h2 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xs);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
    }

    .close-btn:hover {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .shortcuts-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--spacing-lg);
        overscroll-behavior-y: contain
    }

    .shortcut-category {
        background-color: var(--bg-surface);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
    }

    .category-title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--accent-primary);
        margin: 0 0 var(--spacing-sm) 0;
    }

    .shortcuts-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    .shortcut-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-md);
        padding: var(--spacing-xs) 0;
    }

    .shortcut-key {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .key-separator {
        color: var(--text-subdued);
        font-size: 0.75rem;
    }

    kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 24px;
        padding: 0 var(--spacing-xs);
        background-color: var(--bg-highlight);
        border: 1px solid var(--text-subdued);
        border-radius: var(--radius-xs);
        font-size: 0.75rem;
        font-weight: 500;
        font-family: inherit;
        color: var(--text-primary);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .shortcut-description {
        color: var(--text-secondary);
        font-size: 0.875rem;
        text-align: right;
    }

    .modal-footer {
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--bg-highlight);
        flex-shrink: 0;
    }

    .hint {
        color: var(--text-subdued);
        font-size: 0.75rem;
        text-align: center;
        margin: 0;
    }

    .hint kbd {
        margin: 0 2px;
    }
</style>
