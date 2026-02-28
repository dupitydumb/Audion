<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        pluginStore,
        type PluginUpdateInfo,
    } from "$lib/stores/plugin-store";

    const dispatch = createEventDispatcher();

    function close() {
        dispatch("close");
    }

    // Per-plugin state
    type ItemState = 'idle' | 'loading' | 'success' | 'error';
    let itemStates: Record<string, ItemState> = {};
    let itemBtnEls: Record<string, HTMLButtonElement> = {};

    // Update All button state
    type UpdateAllState = 'idle' | 'loading' | 'success' | 'error';
    let updateAllState: UpdateAllState = 'idle';
    let updateAllBtnEl: HTMLButtonElement;

    // Confetti
    type Particle = { x: number; y: number; color: string; angle: number; speed: number };
    let confettiParticles: Particle[] = [];
    const COLORS = ['#1ed760', '#ff6b6b', '#ffd93d', '#6bceff', '#ff9f43'];

    function spawnConfetti(btnEl: HTMLButtonElement) {
        const rect = btnEl.getBoundingClientRect();
        confettiParticles = Array.from({ length: 22 }, (_, i) => ({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            color: COLORS[i % COLORS.length],
            angle: (i / 22) * 360,
            speed: 3 + Math.random() * 4,
        }));
        setTimeout(() => { confettiParticles = []; }, 1500);
    }

    $: updatedCount = Object.values(itemStates).filter(s => s === 'success').length;
    $: totalCount = $pluginStore.pendingUpdates.length;
    $: allDone = updatedCount === totalCount && totalCount > 0;
    $: skipLabel = updatedCount > 0 && !allDone ? 'Skip Remaining' : allDone ? 'Close' : 'Not Now';

    async function handleUpdateOne(update: PluginUpdateInfo) {
        if (itemStates[update.name] === 'loading' || itemStates[update.name] === 'success') return;
        itemStates[update.name] = 'loading';
        itemStates = itemStates;

        const success = await pluginStore.updatePlugin(update.name);

        if (success) {
            itemStates[update.name] = 'success';
            itemStates = itemStates;
            if (itemBtnEls[update.name]) spawnConfetti(itemBtnEls[update.name]);

            if (allDone) {
                setTimeout(close, 1800);
            }
        } else {
            itemStates[update.name] = 'error';
            itemStates = itemStates;
            setTimeout(() => {
                itemStates[update.name] = 'idle';
                itemStates = itemStates;
            }, 2500);
        }
    }

    async function handleUpdateAll() {
        if (updateAllState === 'loading') return;
        updateAllState = 'loading';

        const pending = $pluginStore.pendingUpdates.filter(
            u => itemStates[u.name] !== 'success' // skip already updated ones
        );

        let anyFailed = false;

        for (const update of pending) {
            if (itemStates[update.name] === 'success') continue;
            itemStates[update.name] = 'loading';
            itemStates = itemStates;

            const success = await pluginStore.updatePlugin(update.name);

            if (success) {
                itemStates[update.name] = 'success';
                itemStates = itemStates;
            } else {
                itemStates[update.name] = 'error';
                itemStates = itemStates;
                anyFailed = true;
            }
        }

        if (!anyFailed) {
            updateAllState = 'success';
            spawnConfetti(updateAllBtnEl);
            setTimeout(close, 1800);
        } else {
            updateAllState = 'error';
            setTimeout(() => { updateAllState = 'idle'; }, 2500);
        }
    }

    function handleSkip() {
        pluginStore.clearPendingUpdates();
        close();
    }
</script>

<div class="modal-overlay" on:click={close} role="presentation">
    <div class="modal-content" on:click|stopPropagation role="presentation">
        <div class="modal-header">
            <h2>Plugin Updates Available</h2>
            <button class="close-btn" on:click={close}>
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="24"
                    height="24"
                >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>

        <div class="modal-body">
            <p class="description">
                The following plugins have updates available. Would you like to
                update them now?
            </p>

            <div class="update-list">
                {#each $pluginStore.pendingUpdates as update}
                    {@const state = itemStates[update.name] ?? 'idle'}
                    <div class="update-item" class:done={state === 'success'}>
                        <div class="update-info">
                            <span class="plugin-name">{update.name}</span>
                            <div class="version-info">
                                <span class="old-version"
                                    >v{update.current_version}</span
                                >
                                <span class="arrow">→</span>
                                <span class="new-version"
                                    >v{update.new_version}</span
                                >
                            </div>
                        </div>
                        <div class="item-actions">
                            <a href={update.repo_url} target="_blank" rel="noopener noreferrer" class="changelog-link">
                                Changelog
                            </a>
                            <button
                                class="btn-update-one"
                                class:loading={state === 'loading'}
                                class:success={state === 'success'}
                                class:error={state === 'error'}
                                disabled={state === 'loading' || state === 'success'}
                                bind:this={itemBtnEls[update.name]}
                                on:click={() => handleUpdateOne(update)}
                            >
                                {#if state === 'loading'}
                                    <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14">
                                        <circle cx="12" cy="12" r="10" stroke-width="3" opacity="0.25"/>
                                        <path d="M12 2a10 10 0 0 1 10 10" stroke-width="3" stroke-linecap="round"/>
                                    </svg>
                                {:else if state === 'success'}
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline class="check-path" points="4,12 10,18 20,6" stroke-width="2.5"/>
                                    </svg>
                                {:else if state === 'error'}
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-linecap="round">
                                        <path d="M18 6L6 18M6 6l12 12" stroke-width="2.5"/>
                                    </svg>
                                {:else}
                                    Update
                                {/if}
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <div class="modal-footer">
            <button class="btn-secondary" on:click={handleSkip}>
                {skipLabel}
            </button>
            <button
                class="btn-primary"
                class:loading={updateAllState === 'loading'}
                class:success={updateAllState === 'success'}
                class:error={updateAllState === 'error'}
                disabled={updateAllState === 'loading' || updateAllState === 'success' || allDone}
                bind:this={updateAllBtnEl}
                on:click={handleUpdateAll}
            >
                {#if updateAllState === 'loading'}
                    <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                        <circle cx="12" cy="12" r="10" stroke-width="3" opacity="0.25"/>
                        <path d="M12 2a10 10 0 0 1 10 10" stroke-width="3" stroke-linecap="round"/>
                    </svg>
                    Updating...
                {:else if updateAllState === 'success'}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-linecap="round" stroke-linejoin="round">
                        <polyline class="check-path" points="4,12 10,18 20,6" stroke-width="2.5"/>
                    </svg>
                    Done!
                {:else if updateAllState === 'error'}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-linecap="round">
                        <path d="M18 6L6 18M6 6l12 12" stroke-width="2.5"/>
                    </svg>
                    Some Failed
                {:else if allDone}
                    All Updated
                {:else}
                    Update All{updatedCount > 0 ? ` Remaining (${totalCount - updatedCount})` : ''}
                {/if}
            </button>
        </div>
    </div>
</div>

<!-- Confetti -->
{#each confettiParticles as p, i}
    <div
        class="confetti-particle"
        style="left: {p.x}px; top: {p.y}px; background: {p.color}; --angle: {p.angle}deg; --speed: {p.speed}; animation-delay: {i * 0.03}s;"
    ></div>
{/each}

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(4px);
        padding: var(--spacing-md);
    }

    .modal-content {
        background-color: var(--bg-surface);
        width: 100%;
        max-width: 500px;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        box-shadow:
            0 20px 25px -5px rgba(0, 0, 0, 0.1),
            0 10px 10px -5px rgba(0, 0, 0, 0.04);
        overflow: hidden;
    }

    .modal-header {
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: var(--bg-surface);
    }

    .modal-header h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-subdued);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: all 0.2s;
    }

    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .modal-body {
        padding: var(--spacing-lg);
        overflow-y: auto;
        max-height: 60vh;
        overscroll-behavior-y: contain
    }

    .description {
        color: var(--text-secondary);
        margin-top: 0;
        margin-bottom: var(--spacing-lg);
        font-size: 0.9375rem;
    }

    .update-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .update-item {
        background-color: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: border-color 0.2s, opacity 0.2s;
    }

    .update-item.done {
        opacity: 0.5;
        border-color: #1ed760;
    }

    .update-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .plugin-name {
        font-weight: 600;
        color: var(--text-primary);
        font-size: 0.9375rem;
    }

    .version-info {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8125rem;
    }

    .old-version { color: var(--text-subdued); }
    .arrow { color: var(--text-subdued); }
    .new-version { color: #22c55e; font-weight: 600; }

    .item-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .changelog-link {
        color: var(--accent-primary);
        font-size: 0.8125rem;
        text-decoration: none;
    }

    .changelog-link:hover { text-decoration: underline; }

    .btn-update-one {
        padding: 5px 12px;
        border-radius: var(--radius-sm);
        font-size: 0.8125rem;
        font-weight: 500;
        background-color: var(--bg-elevated);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
        cursor: pointer;
        transition: background-color 0.2s;
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 70px;
        justify-content: center;
    }

    .btn-update-one:hover:not(:disabled) { background-color: var(--bg-highlight); }
    .btn-update-one:disabled { cursor: not-allowed; }
    .btn-update-one.success { background-color: rgba(30,215,96,0.15); border-color: #1ed760; color: #1ed760; }
    .btn-update-one.error { background-color: rgba(239,68,68,0.15); border-color: #ef4444; color: #ef4444; }
    .btn-update-one.loading { opacity: 0.75; }

    .modal-footer {
        padding: var(--spacing-lg);
        border-top: 1px solid var(--border-color);
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-md);
        background-color: var(--bg-surface);
    }

    .btn-primary {
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        font-weight: 500;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s;
        background-color: var(--accent-primary);
        color: white;
        border: none;
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 120px;
        justify-content: center;
    }

    .btn-primary:hover:not(:disabled) { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary.success { background-color: #1ed760; }
    .btn-primary.error { background-color: #ef4444; }

    .btn-secondary {
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        font-weight: 500;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s;
        background-color: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
        background-color: rgba(255, 255, 255, 0.05);
        color: var(--text-primary);
    }

    .spin { animation: spin 0.8s linear infinite; }

    @keyframes spin { to { transform: rotate(360deg); } }

    .check-path {
        stroke-dasharray: 30;
        stroke-dashoffset: 30;
        animation: draw-check 0.5s ease forwards;
    }

    @keyframes draw-check { to { stroke-dashoffset: 0; } }

    .confetti-particle {
        position: fixed;
        width: 7px;
        height: 7px;
        border-radius: 2px;
        pointer-events: none;
        z-index: 9999;
        animation: confetti-burst 1.2s ease-out forwards;
    }

    @keyframes confetti-burst {
        0% { transform: translate(0,0) rotate(0deg) scale(1); opacity: 1; }
        100% {
            transform:
                translate(
                    calc(cos(var(--angle)) * calc(var(--speed) * 30px)),
                    calc(sin(var(--angle)) * calc(var(--speed) * 30px) - 80px)
                )
                rotate(720deg) scale(0);
            opacity: 0;
        }
    }
</style>
