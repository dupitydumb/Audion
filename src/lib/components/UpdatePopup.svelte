<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { openUrl } from "@tauri-apps/plugin-opener";
    import { marked } from "marked";
    import DOMPurify from "dompurify";
    import { _ } from "svelte-i18n";
    marked.use({ async: false });

    export let release: any = null;

    /**
     * github  => plain release notes + asset download links
     * ota     => notes + skip/download/progress/restart-later
     */
    export let mode: "github" | "ota" = "github";

    /**
     * only used when mode === ota:
     *  available   => notes + Skip this version + Download
     *  downloading => notes + progress bar (no buttons, close still allowed)
     *  ready       => notes + Restart Now / Later / Skip this version
     */
    export let otaPhase: "available" | "downloading" | "ready" = "available";
    export let otaProgress: number = 0;

    const dispatch = createEventDispatcher();

    let isBusy = false; // guards restart-now button while install() is in flight

    function close() {
        dispatch("close");
    }

    function handleDownload() {
        dispatch("download");
    }

    function handleSkip() {
        dispatch("skip");
    }

    async function handleRestartNow() {
        isBusy = true;
        dispatch("restart");
        // caller resets state on failure; on success the app is expected to
        // relaunch out from under us, so no need to reset isBusy here
    }

    function handleLater() {
        dispatch("later");
        close();
    }

    function formatDate(dateString: string) {
        if (!dateString) return "";
        return new Date(dateString).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }

    async function downloadAsset(url: string) {
        try {
            await openUrl(url);
        } catch (error) {
            console.error("Failed to open URL:", error);
        }
    }

    function formatSize(bytes: number) {
        const units = ["B", "KB", "MB", "GB"];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    // cross-button is always available except mid-install
    $: canClose = !(mode === "ota" && isBusy);
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="modal-overlay" on:click={canClose ? close : undefined}>
    <div class="modal-content" on:click|stopPropagation>
        <div class="modal-header">
            <div class="header-info">
                <h2>
                    {#if mode === "ota" && otaPhase === "ready"}
                        {$_('updatePopup.restartToUpdate')}
                    {:else}
                        {release?.name || release?.tag_name || $_('settings.updateAvailable')}
                    {/if}
                </h2>
                <div class="meta">
                    <span class="tag">{release?.tag_name}</span>
                    {#if release?.published_at}
                        <span class="date">{formatDate(release?.published_at)}</span>
                    {/if}
                    {#if mode === "ota" && otaPhase === "ready"}
                        <span class="ota-badge">{$_('updatePopup.installedRestartRequired')}</span>
                    {:else if mode === "ota" && otaPhase === "downloading"}
                        <span class="ota-badge">{$_('updatePopup.downloading')}</span>
                    {/if}
                </div>
            </div>
            {#if canClose}
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
            {/if}
        </div>

        <div class="modal-body">
            {#if release?.body}
                <div class="release-notes markdown-content">
                    {@html DOMPurify.sanitize(marked.parse(release.body) as string)}
                </div>
            {:else}
                <p class="no-notes">{$_('updatePopup.noReleaseNotes')}</p>
            {/if}

            {#if mode === "ota"}
                {#if otaPhase === "available"}
                    <div class="ota-actions">
                        <div class="ota-buttons">
                            <button class="btn-restart" on:click={handleDownload}>
                                {$_('updatePopup.download')}
                            </button>
                            <button class="btn-later" on:click={handleSkip}>
                                {$_('updatePopup.skipVersion')}
                            </button>
                        </div>
                    </div>
                {:else if otaPhase === "downloading"}
                    <div class="ota-actions">
                        <div class="progress-track">
                            <div class="progress-fill" style="width: {otaProgress}%"></div>
                        </div>
                        <p class="ota-hint">{otaProgress}%</p>
                    </div>
                {:else if otaPhase === "ready"}
                    <div class="ota-actions">
                        <p class="ota-hint">{$_('updatePopup.otaHint')}</p>
                        <div class="ota-buttons">
                            <button
                                class="btn-restart"
                                on:click={handleRestartNow}
                                disabled={isBusy}
                            >
                                {#if isBusy}
                                    {$_('updatePopup.restarting')}
                                {:else}
                                    {$_('updatePopup.restartNow')}
                                {/if}
                            </button>
                            <button class="btn-later" on:click={handleLater} disabled={isBusy}>
                                {$_('updatePopup.later')}
                            </button>
                            <button class="btn-skip" on:click={handleSkip} disabled={isBusy}>
                                {$_('updatePopup.skipVersion')}
                            </button>
                        </div>
                    </div>
                {/if}
            {:else if release?.assets && release.assets.length > 0}
                <div class="assets-section">
                    <h3>{$_('updatePopup.assets')}</h3>
                    <div class="assets-list">
                        {#each release.assets as asset}
                            <div class="asset-item">
                                <div class="asset-info">
                                    <span class="asset-name">{asset.name}</span>
                                    <span class="asset-size"
                                        >{formatSize(asset.size)}</span
                                    >
                                </div>
                                <button
                                    class="download-btn"
                                    on:click={() =>
                                        downloadAsset(
                                            asset.browser_download_url,
                                        )}
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        width="16"
                                        height="16"
                                    >
                                        <path
                                            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                                        ></path>
                                        <polyline points="7 10 12 15 17 10"
                                        ></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"
                                        ></line>
                                    </svg>
                                    {$_('updatePopup.download')}
                                </button>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

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
        max-width: 600px;
        max-height: 85vh;
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
        align-items: flex-start;
        background-color: var(--bg-surface);
    }

    .header-info h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        line-height: var(--line-height-tight);
        margin-bottom: var(--spacing-xs);
    }

    .meta {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .tag {
        background-color: var(--accent-primary);
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
    }

    .date {
        color: var(--text-subdued);
        font-size: var(--font-size-base);
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
        color: var(--text-secondary);
        overscroll-behavior-y: contain;
    }

    .release-notes {
        line-height: 1.6;
        margin-bottom: var(--spacing-xl);
        font-size: 0.9375rem;
    }

    .markdown-content :global(h1),
    .markdown-content :global(h2),
    .markdown-content :global(h3) {
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .markdown-content :global(h1) {
        font-size: 1.25rem;
    }
    .markdown-content :global(h2) {
        font-size: 1.1rem;
    }
    .markdown-content :global(h3) {
        font-size: var(--font-size-md);
    }

    .markdown-content :global(p) {
        margin-bottom: 1em;
    }

    .markdown-content :global(ul),
    .markdown-content :global(ol) {
        margin-bottom: 1em;
        padding-left: 1.5em;
    }

    .markdown-content :global(li) {
        margin-bottom: 0.25em;
    }

    .markdown-content :global(a) {
        color: var(--accent-primary);
        text-decoration: none;
    }

    .markdown-content :global(a:hover) {
        text-decoration: underline;
    }

    .markdown-content :global(code) {
        background-color: rgba(255, 255, 255, 0.1);
        padding: 0.2em 0.4em;
        border-radius: 4px;
        font-family: monospace;
        font-size: 0.85em;
    }

    .markdown-content :global(pre) {
        background-color: rgba(255, 255, 255, 0.05);
        padding: 1em;
        border-radius: 8px;
        overflow-x: auto;
        margin-bottom: 1em;
    }

    .markdown-content :global(pre code) {
        background-color: transparent;
        padding: 0;
    }

    .markdown-content :global(img) {
        max-width: 100%;
        border-radius: 8px;
        margin: 1em 0;
    }

    .assets-section h3 {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin-bottom: var(--spacing-md);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .assets-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .asset-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        background-color: rgba(255, 255, 255, 0.03);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
    }

    .asset-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .asset-name {
        color: var(--text-primary);
        font-weight: var(--font-weight-medium);
        font-size: 0.9375rem;
    }

    .asset-size {
        color: var(--text-subdued);
        font-size: var(--font-size-xs);
    }

    .download-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: 6px 12px;
        background-color: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all 0.2s;
    }

    .download-btn:hover {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }

    .no-notes {
        font-size: var(--font-size-base);
        color: var(--text-subdued);
        font-style: italic;
        margin: 0 0 var(--spacing-md);
    }

    /* ── OTA mode ── */

    .ota-badge {
        background-color: color-mix(in srgb, var(--accent-primary), transparent 82%);
        color: var(--accent-primary);
        border: 1px solid color-mix(in srgb, var(--accent-primary), transparent 65%);
        padding: 2px 8px;
        border-radius: 12px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
    }

    .ota-actions {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
    }

    .ota-hint {
        font-size: 0.9rem;
        color: var(--text-secondary);
        line-height: var(--line-height-normal);
        margin: 0;
    }

    .ota-buttons {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
    }

    .btn-restart {
        flex: 1;
        padding: 10px 20px;
        background-color: var(--accent-primary);
        color: #000;
        border: none;
        border-radius: var(--radius-md);
        font-size: 0.9375rem;
        font-weight: var(--font-weight-bold);
        cursor: pointer;
        transition: background-color 0.2s, transform 0.15s;
    }

    .btn-restart:hover:not(:disabled) {
        background-color: var(--accent-hover);
        transform: translateY(-1px);
    }

    .btn-restart:disabled {
        opacity: 0.6;
        cursor: wait;
    }

    .btn-later {
        padding: 10px 20px;
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        font-size: 0.9375rem;
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: background-color 0.2s, color 0.2s;
    }

    .btn-later:hover:not(:disabled) {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .btn-later:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-skip {
        padding: 10px 20px;
        background: transparent;
        color: var(--text-subdued);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: background-color 0.2s, color 0.2s;
    }

    .btn-skip:hover:not(:disabled) {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .btn-skip:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .progress-track {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background-color: var(--bg-highlight);
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background-color: var(--accent-primary);
        transition: width 0.2s ease;
    }

</style>
