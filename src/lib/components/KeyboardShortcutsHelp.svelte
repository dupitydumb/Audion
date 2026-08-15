<script lang="ts">
    import { _ } from "svelte-i18n";
    import { fade, fly } from "svelte/transition";
    import {
        isShortcutsHelpVisible,
        hideShortcutsHelp,
        shortcutBindings,
        shortcutDefinitions,
        defaultBindings,
        getBindingsByCategory,
        findConflict,
        deriveGlobalString,
        buildKeyDisplay,
        categoryNames,
        type ShortcutBinding,
        type ShortcutDefinition,
    } from "$lib/stores/shortcuts";

    let editMode = false;

    function toggleEditMode() {
        editMode = !editMode;
        // cancel any in-progress capture when switching modes
        cancelCapture();
    }

    function handleClose() {
        editMode = false;
        cancelCapture();
        hideShortcutsHelp();
    }

    $: byCategory = getBindingsByCategory($shortcutBindings);

    interface CaptureTarget {
        action: string;
        oldKeyDisplay: string;
    }

    let capturing: CaptureTarget | null = null;

    // set when a captured key conflicts with an existing binding
    interface ConflictInfo {
        conflicting: ShortcutBinding;
        candidate: Partial<ShortcutBinding>;
    }
    let pendingConflict: ConflictInfo | null = null;

    // per-binding error messages come directly from binding.globalError (set by the store)

    function startCapture(action: string, keyDisplay: string) {
        cancelCapture();
        capturing = { action, oldKeyDisplay: keyDisplay };
        pendingConflict = null;
    }

    function cancelCapture() {
        capturing = null;
        pendingConflict = null;
    }

    function handleCaptureKeydown(e: KeyboardEvent) {
        if (!capturing) return;

        // escape cancels capture
        if (e.key === "Escape") {
            e.preventDefault();
            cancelCapture();
            return;
        }

        // ignore bare modifier keypresses
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

        e.preventDefault();
        e.stopPropagation();

        // determine matchType: letter keys use code, others use key
        const isLetterKey = e.code.startsWith("Key");
        const isDigitKey  = e.code.startsWith("Digit");
        const useCode     = isLetterKey || isDigitKey || ["Slash"].includes(e.code);

        const candidate: Partial<ShortcutBinding> = {
            key:        useCode ? e.code : e.key,
            matchType:  useCode ? "code" : "key",
            modifiers: {
                ctrl:  e.ctrlKey  || undefined,
                shift: e.shiftKey || undefined,
                alt:   e.altKey   || undefined,
            },
            keyDisplay: buildKeyDisplay(e),
        };

        // check for conflicts , pass oldKeyDisplay so same-action multi-binding
        // actions can detect intra-action duplicates
        const conflict = findConflict(
            candidate as Pick<ShortcutBinding, "key" | "matchType" | "modifiers">,
            capturing.action,
            $shortcutBindings,
            capturing.oldKeyDisplay,
        );

        if (conflict) {
            pendingConflict = { conflicting: conflict, candidate };
            return;
        }

        applyCapture(candidate);
    }

    function applyCapture(candidate: Partial<ShortcutBinding>) {
        if (!capturing) return;
        shortcutBindings.updateBinding(capturing.action, capturing.oldKeyDisplay, candidate);
        capturing = null;
        pendingConflict = null;
    }

    /** user confirms overwriting the conflicting binding */
    function resolveConflictForce() {
        if (!pendingConflict || !capturing) return;

        // unbind the conflicting one by resetting just it to an empty-ish state
        // we mark it with an empty keyDisplay so the user knows it needs rebinding
        shortcutBindings.updateBinding(
            pendingConflict.conflicting.action,
            pendingConflict.conflicting.keyDisplay,
            { key: "", matchType: "key", modifiers: {}, keyDisplay: "(unbound)", isGlobal: false, globalString: null }
        );

        applyCapture(pendingConflict.candidate);
    }

    interface GlobalToggleResult {
        action: string;
        keyDisplay: string;
        success: boolean;
        error?: string;
    }

    async function handleGlobalToggle(binding: ShortcutBinding) {
        if (!binding.isGlobal) {
            const gs = deriveGlobalString(binding);
            if (!gs) {
                // key cannot be made global (e.g. bare arrow keys, Space).=
                // use setGlobal to write the error so the binding is matched correctly
                // by action+keyDisplay rather than globalString (which is null here)
                shortcutBindings.setGlobal(binding.action, binding.keyDisplay, false, null);
                shortcutBindings.markGlobalError(
                    binding.action,
                    binding.keyDisplay,
                    $_('shortcuts.globalErrorBareKeys')
                );
                return;
            }
            shortcutBindings.setGlobal(binding.action, binding.keyDisplay, true, gs);
        } else {
            shortcutBindings.setGlobal(binding.action, binding.keyDisplay, false, null);
        }
    }

    // markGlobalError is called from KeyboardShortcuts.svelte via the store
    // we surface it here by watching bindingErrors via the store's error mechanism
    // (the store exposes markGlobalError which sets a flag we read below)

    function handleResetAction(action: string) {
        // before restoring the default, check if another action currently owns
        // that key. if so, unbind it first to avoid a silent duplicate
        const def = defaultBindings.find(b => b.action === action);
        if (def?.key) {
            const conflict = findConflict(
                { key: def.key, matchType: def.matchType, modifiers: def.modifiers ?? {} },
                action,
                $shortcutBindings,
                // No excludeKeyDisplay: we want to catch ALL other slots, not just
                // slots of other actions
            );
            if (conflict) {
                shortcutBindings.updateBinding(
                    conflict.action,
                    conflict.keyDisplay,
                    { key: "", matchType: "key", modifiers: {}, keyDisplay: "(unbound)", isGlobal: false, globalString: null }
                );
            }
        }
        shortcutBindings.resetAction(action);
    }

    function handleResetAll() {
        shortcutBindings.resetToDefaults();
    }

    let captureOverlayEl: HTMLElement;

    // Svelte action: focus the capture overlay div so keydown fires on it
    function focusOnMount(node: HTMLElement) {
        node.focus();
        return {};
    }

    function getDescription(action: string): string {
        return shortcutDefinitions.find(d => d.action === action)?.description ?? action;
    }

    function formatKeyDisplay(keyDisplay: string): string[] {
        // split "Ctrl + F" into ["Ctrl", "F"]
        return keyDisplay.split(" + ").map(p => p.trim()).filter(Boolean);
    }

    function isUnbound(binding: ShortcutBinding): boolean {
        return !binding.key || binding.keyDisplay === "(unbound)";
    }
</script>

<!-- capture keydown globally when in capture mode -->
{#if capturing}
    <div
        class="capture-overlay"
        role="dialog"
        aria-label="Press a key to bind"
        on:keydown={handleCaptureKeydown}
        tabindex="-1"
        bind:this={captureOverlayEl}
        use:focusOnMount
    >
        <div class="capture-prompt">
            <p>{$_('shortcuts.pressKeyCombo')}</p>
            <p class="capture-hint">{$_('shortcuts.pressToCancelPrefix')} <kbd>Esc</kbd> {$_('shortcuts.pressToCancelSuffix')}</p>

            {#if pendingConflict}
                <div class="conflict-warning">
                    <p>
                        <strong>{pendingConflict.candidate.keyDisplay}</strong> {$_('shortcuts.alreadyBoundTo')}
                        <strong>{getDescription(pendingConflict.conflicting.action)}</strong>.
                    </p>
                    <div class="conflict-actions">
                        <button class="btn-danger" on:click={resolveConflictForce}>
                            {$_('shortcuts.overwrite')}
                        </button>
                        <button class="btn-secondary" on:click={cancelCapture}>
                            {$_('common.cancel')}
                        </button>
                    </div>
                </div>
            {/if}
        </div>
    </div>
{/if}

{#if $isShortcutsHelpVisible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="shortcuts-overlay"
        transition:fade={{ duration: 200 }}
        on:click={handleClose}
        on:keydown={(e) => e.key === "Escape" && handleClose()}
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
            <!-- Header -->
            <header class="modal-header">
                <h2>{$_('settings.shortcuts')}</h2>
                <div class="header-actions">
                    {#if editMode}
                        <button class="btn-text-danger" on:click={handleResetAll} title={$_('shortcuts.resetAllTitle')}>
                            {$_('shortcuts.resetAll')}
                        </button>
                    {/if}
                    <button
                        class="edit-btn"
                        class:active={editMode}
                        on:click={toggleEditMode}
                        title={editMode ? $_('shortcuts.doneEditingTitle') : $_('shortcuts.editShortcutsTitle')}
                    >
                        {#if editMode}
                            {$_('shortcuts.doneEditing')}
                        {:else}
                            <!-- pencil icon -->
                            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                            {$_('shortcuts.editMode')}
                        {/if}
                    </button>
                    <button class="close-btn" on:click={handleClose} title={$_('shortcuts.closeWithEsc')}>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
            </header>

            <!-- content -->
            <div class="shortcuts-content">
                {#each Object.entries(byCategory) as [category, entries]}
                    {#if entries.length > 0}
                        <section class="shortcut-category">
                            <h3 class="category-title">{categoryNames[category]}</h3>
                            <div class="shortcuts-list">
                                {#each entries as { definition, binding }}
                                    {@const hasError = !!binding.globalError}

                                    <div class="shortcut-item" class:unbound={isUnbound(binding)}>
                                        <!-- key display / capture button -->
                                        {#if editMode && definition.rebindable}
                                            <div class="shortcut-edit-controls">
                                                <button
                                                    class="key-capture-btn"
                                                    class:capturing={capturing?.action === binding.action && capturing?.oldKeyDisplay === binding.keyDisplay}
                                                    on:click={() => startCapture(binding.action, binding.keyDisplay)}
                                                    title={$_('shortcuts.clickToRebind')}
                                                >
                                                    {#if isUnbound(binding)}
                                                        <span class="unbound-label">{$_('shortcuts.unboundLabel')}</span>
                                                    {:else}
                                                        {#each formatKeyDisplay(binding.keyDisplay) as part, i}
                                                            {#if i > 0}<span class="key-separator">+</span>{/if}
                                                            <kbd>{part}</kbd>
                                                        {/each}
                                                    {/if}
                                                </button>

                                                <!-- global toggle -->
                                                <button
                                                    class="global-btn"
                                                    class:active={binding.isGlobal}
                                                    class:error={hasError}
                                                    on:click={() => handleGlobalToggle(binding)}
                                                    title={
                                                        hasError
                                                            ? binding.globalError
                                                            : binding.isGlobal
                                                                ? $_('shortcuts.globalOnHint')
                                                                : $_('shortcuts.makeGlobalHint')
                                                    }
                                                    disabled={isUnbound(binding)}
                                                >
                                                    <!-- globe icon -->
                                                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                                                    </svg>
                                                </button>

                                                <!-- reset this action -->
                                                <button
                                                    class="reset-action-btn"
                                                    on:click={() => handleResetAction(binding.action)}
                                                    title={$_('shortcuts.resetToDefaultTitle')}
                                                >
                                                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                                        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        {:else}
                                            <!-- view mode -->
                                            <span class="shortcut-key">
                                                {#if isUnbound(binding)}
                                                    <span class="unbound-label">—</span>
                                                {:else}
                                                    {#each formatKeyDisplay(binding.keyDisplay) as part, i}
                                                        {#if i > 0}<span class="key-separator">+</span>{/if}
                                                        <kbd>{part}</kbd>
                                                    {/each}
                                                {/if}
                                                {#if binding.isGlobal}
                                                    <span class="global-badge" title={$_('shortcuts.globalShortcutTitle')}>G</span>
                                                {/if}
                                            </span>
                                        {/if}

                                        <span class="shortcut-description">{definition.description}</span>
                                    </div>

                                    <!-- error message row -->
                                    {#if binding.globalError && editMode}
                                        <p class="binding-error">{binding.globalError}</p>
                                    {/if}
                                {/each}
                            </div>
                        </section>
                    {/if}
                {/each}
            </div>

            <!-- Footer -->
            <footer class="modal-footer">
                {#if editMode}
                    <p class="hint">{$_('shortcuts.clickBadgeToRebind')} <kbd>Esc</kbd> {$_('shortcuts.cancelsCapture')}</p>
                {:else}
                    <p class="hint">{$_('shortcuts.pressToToggleHelpPrefix')} <kbd>?</kbd> {$_('shortcuts.toToggleHelp')} <kbd>Esc</kbd> {$_('shortcuts.toClose')}</p>
                {/if}
            </footer>
        </div>
    </div>
{/if}



<style>
    /* overlay & modal */

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
        max-width: 720px;
        max-height: 82vh;
        width: 90%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    /* header */

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--bg-highlight);
        flex-shrink: 0;
        gap: var(--spacing-md);
    }

    .modal-header h2 {
        font-size: 1.25rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
        flex: 1;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .edit-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
        border: 1px solid var(--bg-highlight);
        transition: all var(--transition-fast);
    }

    .edit-btn:hover,
    .edit-btn.active {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
        color: #fff;
    }

    .btn-text-danger {
        font-size: var(--font-size-sm);
        color: var(--color-error, #e05252);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);
    }

    .btn-text-danger:hover {
        background-color: rgba(224, 82, 82, 0.1);
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

    /* content grid */

    .shortcuts-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: var(--spacing-lg);
        overscroll-behavior-y: contain;
    }

    .shortcut-category {
        background-color: var(--bg-surface);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
    }

    .category-title {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
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

    /* shortcut row */

    .shortcut-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-md);
        padding: var(--spacing-xs) 0;
        min-height: 32px;
    }

    .shortcut-item.unbound .shortcut-description {
        color: var(--text-subdued);
    }

    .shortcut-key {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .key-separator {
        color: var(--text-subdued);
        font-size: var(--font-size-xs);
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
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        font-family: inherit;
        color: var(--text-primary);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .shortcut-description {
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        text-align: right;
        flex: 1;
    }

    .unbound-label {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
    }

    .global-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background-color: var(--accent-primary);
        color: #fff;
        font-size: 0.625rem;
        font-weight: var(--font-weight-bold);
        margin-left: 4px;
    }

    /* edit controls */

    .shortcut-edit-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .key-capture-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 60px;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        border: 1px dashed var(--text-subdued);
        background: transparent;
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .key-capture-btn:hover {
        border-color: var(--accent-primary);
        background-color: rgba(var(--accent-primary-rgb, 99, 102, 241), 0.08);
    }

    .key-capture-btn.capturing {
        border-color: var(--accent-primary);
        border-style: solid;
        background-color: rgba(var(--accent-primary-rgb, 99, 102, 241), 0.12);
        animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.6; }
    }

    .global-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-highlight);
        color: var(--text-subdued);
        transition: all var(--transition-fast);
        flex-shrink: 0;
    }

    .global-btn:hover:not(:disabled) {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
    }

    .global-btn.active {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
        color: #fff;
    }

    .global-btn.error {
        border-color: var(--color-error, #e05252);
        color: var(--color-error, #e05252);
    }

    .global-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .reset-action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-highlight);
        color: var(--text-subdued);
        transition: all var(--transition-fast);
        flex-shrink: 0;
    }

    .reset-action-btn:hover {
        border-color: var(--text-secondary);
        color: var(--text-primary);
    }

    /* conflict & error UI */

    .binding-error {
        font-size: var(--font-size-xs);
        color: var(--color-error, #e05252);
        margin: 2px 0 4px 0;
        padding-left: 4px;
    }

    /* capture overlay */

    .capture-overlay {
        position: fixed;
        inset: 0;
        z-index: 10000; /* above the shortcuts modal */
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
    }

    .capture-prompt {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-lg);
        padding: var(--spacing-xl);
        text-align: center;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
        min-width: 280px;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .capture-prompt p {
        color: var(--text-primary);
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-medium);
        margin: 0;
    }

    .capture-hint {
        font-size: var(--font-size-sm) !important;
        font-weight: var(--font-weight-normal) !important;
        color: var(--text-subdued) !important;
    }

    .conflict-warning {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-md);
        background-color: rgba(224, 82, 82, 0.1);
        border: 1px solid var(--color-error, #e05252);
        border-radius: var(--radius-md);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .conflict-warning p {
        font-size: var(--font-size-base) !important;
        font-weight: var(--font-weight-normal) !important;
        color: var(--text-primary) !important;
        margin: 0;
    }

    .conflict-actions {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: center;
    }

    .btn-danger {
        padding: var(--spacing-xs) var(--spacing-md);
        background-color: var(--color-error, #e05252);
        color: #fff;
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        transition: opacity var(--transition-fast);
    }

    .btn-danger:hover { opacity: 0.85; }

    .btn-secondary {
        padding: var(--spacing-xs) var(--spacing-md);
        background-color: var(--bg-highlight);
        color: var(--text-primary);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        transition: background-color var(--transition-fast);
    }

    .btn-secondary:hover { background-color: var(--bg-surface); }

    /* footer */

    .modal-footer {
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--bg-highlight);
        flex-shrink: 0;
    }

    .hint {
        color: var(--text-subdued);
        font-size: var(--font-size-xs);
        text-align: center;
        margin: 0;
    }

    .hint kbd {
        margin: 0 2px;
    }
</style>
