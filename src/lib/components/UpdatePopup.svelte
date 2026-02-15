<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { openUrl } from "@tauri-apps/plugin-opener";
    import { marked } from "marked";

    export let release: any = null;

    const dispatch = createEventDispatcher();

    function close() {
        dispatch("close");
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
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="modal-overlay" on:click={close}>
    <div class="modal-content" on:click|stopPropagation>
        <div class="modal-header">
            <div class="header-info">
                <h2>
                    {release?.name || release?.tag_name || "Update Available"}
                </h2>
                <div class="meta">
                    <span class="tag">{release?.tag_name}</span>
                    <span class="date">{formatDate(release?.published_at)}</span
                    >
                </div>
            </div>
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
            {#if release?.body}
                <div class="release-notes markdown-content">
                    {@html marked.parse(release.body)}
                </div>
            {/if}

            {#if release?.assets && release.assets.length > 0}
                <div class="assets-section">
                    <h3>Assets</h3>
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
                                    Download
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
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.2;
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
        font-size: 0.75rem;
        font-weight: 600;
    }

    .date {
        color: var(--text-subdued);
        font-size: 0.875rem;
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
        font-weight: 600;
        color: var(--text-primary);
    }

    .markdown-content :global(h1) {
        font-size: 1.25rem;
    }
    .markdown-content :global(h2) {
        font-size: 1.1rem;
    }
    .markdown-content :global(h3) {
        font-size: 1rem;
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
        font-size: 1rem;
        font-weight: 600;
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
        font-weight: 500;
        font-size: 0.9375rem;
    }

    .asset-size {
        color: var(--text-subdued);
        font-size: 0.75rem;
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
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .download-btn:hover {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }
</style>
