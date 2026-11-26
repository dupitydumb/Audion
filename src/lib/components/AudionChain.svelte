<script lang="ts">
    import { onMount } from "svelte";
    import { _ } from "svelte-i18n";
    import {
        audioChain,
        initAudioChainListener,
        refreshAudioChain,
        type ChainStage,
    } from "$lib/stores/audioChain";

    let expandedStages = new Set<string>();
    let showReasons = false;

    onMount(() => {
        initAudioChainListener();
        refreshAudioChain();
    });

    function toggleStage(id: string) {
        const next = new Set(expandedStages);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        expandedStages = next;
    }

    function verdictLabel(verdict: string): string {
        if (verdict === "bit_perfect") {
            return $_("audionChain.verdictBitPerfect", { default: "Bit-Perfect" });
        }
        if (verdict === "lossless") {
            return $_("audionChain.verdictLossless", { default: "Lossless" });
        }
        return $_("audionChain.verdictProcessed", { default: "Processed" });
    }

    function isModified(stage: ChainStage): boolean {
        return stage.status === "modified" || stage.status === "active";
    }
</script>

<div class="audion-chain" role="region" aria-label={$_("audionChain.title", { default: "Audion Chain" })}>
    <div class="chain-header">
        <div class="chain-title-group">
            <svg class="chain-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12h3l2-6 4 12 3-8 2 2h4" />
            </svg>
            <div>
                <h3 class="chain-title">{$_("audionChain.title", { default: "Audion Chain" })}</h3>
                <p class="chain-subtitle">{$_("audionChain.subtitle", { default: "Live audio signal path" })}</p>
            </div>
        </div>

        {#if $audioChain.active}
            <button
                type="button"
                class="verdict-badge"
                class:bit-perfect={$audioChain.verdict === "bit_perfect"}
                class:lossless={$audioChain.verdict === "lossless"}
                class:processed={$audioChain.verdict === "processed"}
                on:click={() => (showReasons = !showReasons)}
                aria-expanded={showReasons}
                title={$audioChain.reasons.length > 0 ? $audioChain.reasons.join(" • ") : verdictLabel($audioChain.verdict)}
            >
                <span class="verdict-dot" aria-hidden="true"></span>
                <span>{verdictLabel($audioChain.verdict)}</span>
                {#if $audioChain.reasons.length > 0}
                    <svg class="verdict-chevron" class:open={showReasons} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                {/if}
            </button>
        {/if}
    </div>

    {#if showReasons && $audioChain.active && $audioChain.reasons.length > 0}
        <ul class="verdict-reasons" aria-label={$_("audionChain.reasonsLabel", { default: "Signal path notes" })}>
            {#each $audioChain.reasons as reason}
                <li>{reason}</li>
            {/each}
        </ul>
    {/if}

    {#if !$audioChain.active || $audioChain.stages.length === 0}
        <div class="chain-empty">
            <p>{$_("audionChain.empty", { default: "Play a track to inspect its live signal path." })}</p>
        </div>
    {:else}
        <ol class="chain-stages">
            {#each $audioChain.stages as stage, index (stage.id)}
                {@const isLast = index === $audioChain.stages.length - 1}
                {@const modified = isModified(stage)}
                {@const expanded = expandedStages.has(stage.id)}
                <li class="chain-stage" class:modified class:bypassed={stage.status === "bypassed"}>
                    <div class="stage-rail">
                        <div class="stage-icon-wrap" class:modified aria-hidden="true">
                            {#if stage.id === "source"}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="8.5" />
                                    <circle cx="12" cy="12" r="2.5" />
                                </svg>
                            {:else if stage.id === "decoder"}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="4" y="6" width="16" height="12" rx="2.5" />
                                    <path d="M8 12h2l1.5-3 2 6 1.5-3h1" />
                                </svg>
                            {:else if stage.id === "processing"}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M5 7h14M5 12h14M5 17h14" />
                                    <circle cx="9" cy="7" r="1.8" fill="currentColor" />
                                    <circle cx="15" cy="12" r="1.8" fill="currentColor" />
                                    <circle cx="11" cy="17" r="1.8" fill="currentColor" />
                                </svg>
                            {:else if stage.id === "volume"}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M5 10v4h4l5 4V6l-5 4H5z" />
                                    <path d="M17.5 9.5a4 4 0 0 1 0 5" />
                                </svg>
                            {:else}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="4" y="8" width="16" height="8" rx="2" />
                                    <circle cx="9" cy="12" r="1.3" fill="currentColor" />
                                    <path d="M14 12h3" />
                                </svg>
                            {/if}
                        </div>
                        {#if !isLast}
                            <div class="stage-connector" aria-hidden="true">
                                <span class="connector-line"></span>
                                <svg class="connector-arrow" viewBox="0 0 10 8" fill="none">
                                    <path d="M1.5 2L5 6L8.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                            </div>
                        {/if}
                    </div>

                    <div class="stage-body">
                        {#if stage.details.length > 0}
                            <button
                                type="button"
                                class="stage-title-btn"
                                on:click={() => toggleStage(stage.id)}
                                aria-expanded={expanded}
                            >
                                <span class="stage-title">{stage.title}</span>
                            </button>
                        {:else}
                            <div class="stage-title">{stage.title}</div>
                        {/if}
                        <div class="stage-subtitle">{stage.subtitle}</div>

                        {#if expanded && stage.details.length > 0}
                            <dl class="stage-details">
                                {#each stage.details as item}
                                    <div class="stage-detail-row">
                                        <dt>{item.label}</dt>
                                        <dd>{item.value}</dd>
                                    </div>
                                {/each}
                            </dl>
                        {/if}
                    </div>
                </li>
            {/each}
        </ol>
    {/if}
</div>

<style>
    .audion-chain {
        display: flex;
        flex-direction: column;
        gap: 14px;
        color: var(--text-primary);
    }

    .chain-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }

    .chain-title-group {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .chain-header-icon {
        width: 20px;
        height: 20px;
        color: var(--accent-primary);
        flex-shrink: 0;
    }

    .chain-title {
        margin: 0;
        font-size: var(--font-size-md, 1rem);
        font-weight: var(--font-weight-bold, 700);
        color: var(--text-primary);
        line-height: 1.2;
    }

    .chain-subtitle {
        margin: 2px 0 0;
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--text-subdued);
    }

    .verdict-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: var(--radius-full, 9999px);
        border: 1px solid var(--border-subtle, var(--border-color));
        background: var(--surface-subtle, var(--bg-surface));
        color: var(--text-secondary);
        font-size: var(--font-size-xs, 0.75rem);
        font-weight: var(--font-weight-semibold, 600);
        cursor: pointer;
        transition: background-color var(--transition-fast), border-color var(--transition-fast);
    }

    .verdict-badge:hover {
        background: var(--surface-subtle-hover, var(--bg-highlight));
    }

    .verdict-badge.bit-perfect,
    .verdict-badge.lossless {
        color: var(--accent-primary);
        border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
        background: var(--accent-subtle, color-mix(in srgb, var(--accent-primary) 14%, transparent));
    }

    .verdict-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
    }

    .verdict-chevron {
        width: 12px;
        height: 12px;
        transition: transform 0.18s ease;
    }

    .verdict-chevron.open {
        transform: rotate(180deg);
    }

    .verdict-reasons {
        margin: 0;
        padding: 10px 12px 10px 26px;
        border-radius: var(--radius-md, 8px);
        background: var(--surface-subtle, var(--bg-surface));
        border: 1px solid var(--border-subtle, var(--border-color));
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--text-secondary);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .chain-empty {
        padding: 28px 16px;
        text-align: center;
        border-radius: var(--radius-md, 8px);
        background: var(--surface-subtle, var(--bg-surface));
        border: 1px solid var(--border-subtle, var(--border-color));
        color: var(--text-subdued);
        font-size: var(--font-size-sm, 0.8125rem);
    }

    .chain-empty p {
        margin: 0;
    }

    .chain-stages {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
    }

    .chain-stage {
        display: flex;
        align-items: stretch;
        gap: 12px;
        min-height: 52px;
    }

    .stage-rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 32px;
        flex-shrink: 0;
    }

    .stage-icon-wrap {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--surface-subtle, var(--bg-surface));
        border: 1px solid var(--border-subtle, var(--border-color));
        color: var(--text-secondary);
        flex-shrink: 0;
        transition: border-color var(--transition-fast), color var(--transition-fast), background-color var(--transition-fast);
    }

    .stage-icon-wrap.modified {
        color: var(--accent-primary);
        border-color: color-mix(in srgb, var(--accent-primary) 45%, transparent);
        background: var(--accent-subtle, color-mix(in srgb, var(--accent-primary) 14%, transparent));
    }

    .stage-icon-wrap svg {
        width: 16px;
        height: 16px;
    }

    .stage-connector {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-height: 18px;
        padding: 2px 0;
        color: var(--text-subdued);
    }

    .connector-line {
        flex: 1;
        width: 1.5px;
        background: var(--border-subtle, var(--border-color));
        min-height: 8px;
    }

    .connector-arrow {
        width: 10px;
        height: 8px;
        flex-shrink: 0;
        margin-top: -2px;
    }

    .stage-body {
        flex: 1;
        min-width: 0;
        padding: 4px 0 14px;
    }

    .chain-stage:last-child .stage-body {
        padding-bottom: 2px;
    }

    .stage-title-btn {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
    }

    .stage-title-btn .stage-title {
        text-decoration: underline;
        text-decoration-color: var(--border-subtle, var(--border-color));
        text-underline-offset: 3px;
    }

    .stage-title-btn:hover .stage-title,
    .stage-title-btn:focus-visible .stage-title {
        text-decoration-color: var(--accent-primary);
    }

    .stage-title {
        font-size: var(--font-size-base, 0.875rem);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--text-primary);
        line-height: 1.3;
    }

    .chain-stage.modified .stage-title {
        color: var(--accent-primary);
    }

    .stage-subtitle {
        margin-top: 2px;
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--text-subdued);
        line-height: 1.4;
        word-break: break-word;
    }

    .stage-details {
        margin: 8px 0 0;
        padding: 8px 10px;
        border-radius: var(--radius-sm, 6px);
        background: var(--surface-subtle, var(--bg-surface));
        border: 1px solid var(--border-subtle, var(--border-color));
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .stage-detail-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        font-size: var(--font-size-xs, 0.75rem);
    }

    .stage-detail-row dt {
        color: var(--text-subdued);
        flex-shrink: 0;
    }

    .stage-detail-row dd {
        margin: 0;
        color: var(--text-primary);
        font-family: var(--font-mono, monospace);
        text-align: right;
        word-break: break-word;
    }
</style>
