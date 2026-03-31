<script lang="ts">
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import {
        fetchListenbrainzRecommendations,
        type LbRecommendation,
    } from "$lib/api/tauri";
    import { appSettings } from "$lib/stores/settings";
    import { playTrack } from "$lib/stores/player";
    import { getFullTrack } from "$lib/stores/library";
    import {
        goToSettings,
        goToArtistDetail,
        goToDiscover,
    } from "$lib/stores/view";

    type LoadState = "idle" | "loading" | "done" | "error" | "not-configured";

    let recs: LbRecommendation[] = [];
    let state: LoadState = "idle";
    let errorMessage = "";

    async function load() {
        if (!$appSettings.listenBrainzEnabled) {
            state = "not-configured";
            return;
        }
        if (!$appSettings.listenBrainzTokenSet) {
            state = "not-configured";
            return;
        }
        state = "loading";
        try {
            recs = await fetchListenbrainzRecommendations(50);
            state = "done";
        } catch (e) {
            errorMessage = String(e);
            state = "error";
        }
    }

    async function handlePlay(rec: LbRecommendation) {
        if (!rec.local_track_id) {
            handleDiscoverSearch(rec);
            return;
        }
        try {
            const track = await getFullTrack(rec.local_track_id);
            if (track) await playTrack(track);
        } catch (e) {
            console.error("[Recommendations] Play failed:", e);
        }
    }

    function handleArtistClick(name: string) {
        goToArtistDetail(name);
    }

    function handleDiscoverSearch(rec: LbRecommendation) {
        const query = `${rec.artist_name} ${rec.track_name}`;
        goToDiscover(query);
    }

    // Format score as a percentage-like indicator (0–1 → "★★★★☆" stars etc.)
    function scoreLabel(score: number | null): string {
        if (score == null) return "";
        const pct = Math.round(score * 100);
        return `${pct}%`;
    }

    onMount(load);
</script>

<div class="rec-view">
    <header class="view-header">
        <h1>Discover</h1>
        <p class="subtitle">Personalised picks from ListenBrainz</p>
        {#if state === "done"}
            <button
                class="refresh-btn"
                on:click={load}
                aria-label="Refresh recommendations"
            >
                <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                >
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>
                Refresh
            </button>
        {/if}
    </header>

    <div class="rec-content">
        {#if state === "idle" || state === "loading"}
            <div class="state-card" in:fade>
                <div class="spinner"></div>
                <p>Fetching recommendations…</p>
            </div>
        {:else if state === "not-configured"}
            <div class="state-card" in:fade>
                <svg
                    viewBox="0 0 24 24"
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                >
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 8v4m0 4h.01"></path>
                </svg>
                <h3>ListenBrainz not set up</h3>
                <p>
                    Enable ListenBrainz and save a token in Settings to receive
                    personalised recommendations.
                </p>
                <button class="action-btn" on:click={goToSettings}
                    >Open Settings</button
                >
            </div>
        {:else if state === "error"}
            <div class="state-card error" in:fade>
                <svg
                    viewBox="0 0 24 24"
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <h3>Could not load recommendations</h3>
                <p>{errorMessage}</p>
                <button class="action-btn" on:click={load}>Try again</button>
            </div>
        {:else if state === "done" && recs.length === 0}
            <div class="state-card" in:fade>
                <svg
                    viewBox="0 0 24 24"
                    width="56"
                    height="56"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                >
                    <path d="M9 18V5l12-2v13"></path>
                    <circle cx="6" cy="18" r="3"></circle>
                    <circle cx="18" cy="16" r="3"></circle>
                    <line x1="1" y1="1" x2="23" y2="23" stroke-width="1.5"
                    ></line>
                </svg>
                <h3>No recommendations yet</h3>
                <p>
                    ListenBrainz hasn't generated personalised picks for your
                    account yet. This usually happens after scrobbling a few
                    albums — check back in a day or two.
                </p>
                <div class="empty-actions">
                    <button class="action-btn" on:click={load}
                        >Check again</button
                    >
                    <a
                        class="action-link"
                        href="https://listenbrainz.org"
                        target="_blank"
                        rel="noreferrer">View on ListenBrainz ↗</a
                    >
                </div>
            </div>
        {:else if state === "done"}
            <div class="rec-grid">
                {#each recs as rec, i (rec.recording_mbid ?? `${rec.artist_name}-${rec.track_name}-${i}`)}
                    <div
                        class="rec-card"
                        class:matched={rec.local_track_id !== null}
                        in:fly={{ y: 20, delay: Math.min(i * 40, 600) }}
                        role="button"
                        tabindex="0"
                        on:click={() => handlePlay(rec)}
                        on:keydown={(e) => e.key === "Enter" && handlePlay(rec)}
                    >
                        <div class="rec-cover">
                            {#if rec.local_track_id !== null}
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="28"
                                    height="28"
                                >
                                    <path
                                        d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"
                                    />
                                </svg>
                            {:else}
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    width="28"
                                    height="28"
                                >
                                    <path
                                        d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"
                                    />
                                </svg>
                            {/if}
                        </div>

                        <div class="rec-meta">
                            <div class="rec-title" title={rec.track_name}>
                                {rec.track_name}
                            </div>
                            <div
                                class="rec-artist"
                                role="link"
                                tabindex="0"
                                on:click|stopPropagation={() =>
                                    handleArtistClick(rec.artist_name)}
                                on:keydown={(e) =>
                                    e.key === "Enter" &&
                                    handleArtistClick(rec.artist_name)}
                            >
                                {rec.artist_name}
                            </div>
                            {#if rec.release_name}
                                <div class="rec-album">{rec.release_name}</div>
                            {/if}
                        </div>

                        <div class="rec-right">
                            {#if rec.score != null}
                                <span class="rec-score"
                                    >{scoreLabel(rec.score)}</span
                                >
                            {/if}
                            {#if rec.local_track_id !== null}
                                <button
                                    class="play-btn"
                                    on:click|stopPropagation={() =>
                                        handlePlay(rec)}
                                    aria-label="Play {rec.track_name}"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="16"
                                        height="16"
                                    >
                                        <polygon points="5 3 19 12 5 21 5 3"
                                        ></polygon>
                                    </svg>
                                </button>
                            {:else}
                                <span
                                    class="not-in-library"
                                    title="Search in Discover"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2.5"
                                        width="14"
                                        height="14"
                                    >
                                        <circle cx="11" cy="11" r="8"></circle>
                                        <line
                                            x1="21"
                                            y1="21"
                                            x2="16.65"
                                            y2="16.65"
                                        ></line>
                                    </svg>
                                </span>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .rec-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .view-header {
        padding: var(--spacing-xl) var(--spacing-xl) var(--spacing-md);
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        align-items: baseline;
        gap: var(--spacing-lg);
        flex-wrap: wrap;
    }

    .view-header h1 {
        font-size: 1.8rem;
        font-weight: 800;
        color: var(--text-primary);
        margin: 0;
    }

    .subtitle {
        font-size: 0.9rem;
        color: var(--text-secondary);
        flex: 1;
    }

    .refresh-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        color: var(--text-secondary);
        padding: 6px 14px;
        border-radius: var(--radius-md);
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.15s;
    }

    .refresh-btn:hover {
        color: var(--text-primary);
        border-color: var(--accent-primary);
    }

    .rec-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg) var(--spacing-xl);
    }

    /* State cards */
    .state-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: 48px var(--spacing-xl);
        text-align: center;
        color: var(--text-secondary);
        min-height: 300px;
    }

    .empty-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        flex-wrap: wrap;
        justify-content: center;
        margin-top: var(--spacing-sm);
    }

    .action-link {
        font-size: 0.85rem;
        color: var(--text-secondary);
        text-decoration: none;
    }

    .action-link:hover {
        color: var(--accent-primary);
        text-decoration: underline;
    }

    .state-card h3 {
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
    }

    .state-card p {
        max-width: 380px;
        line-height: 1.6;
        margin: 0;
    }

    .state-card.error svg {
        color: var(--text-error, #f44336);
    }

    .action-btn {
        background: var(--accent-primary);
        color: var(--accent-on-primary, #000);
        border: none;
        padding: 10px 24px;
        border-radius: var(--radius-lg);
        font-weight: 700;
        cursor: pointer;
        font-size: 0.9rem;
        margin-top: var(--spacing-sm);
        transition: opacity 0.15s;
    }

    .action-btn:hover {
        opacity: 0.85;
    }

    /* Spinner */
    .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--border-subtle);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* Grid */
    .rec-grid {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .rec-card {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background 0.12s;
        outline: none;
    }

    .rec-card:hover,
    .rec-card:focus-visible {
        background: var(--bg-elevated);
    }

    .rec-card:not(.matched) {
        opacity: 0.55;
    }

    .rec-card:not(.matched):hover {
        opacity: 0.75;
    }

    .rec-cover {
        width: 44px;
        height: 44px;
        background: var(--bg-elevated);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--text-tertiary);
    }

    .matched .rec-cover {
        background: var(--accent-subtle);
        color: var(--accent-primary);
    }

    .rec-meta {
        flex: 1;
        min-width: 0;
    }

    .rec-title {
        font-weight: 600;
        font-size: 0.9rem;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .rec-artist {
        font-size: 0.8rem;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: inline-block;
        max-width: 100%;
        cursor: pointer;
        transition: color 0.1s;
    }

    .rec-artist:hover {
        color: var(--accent-primary);
        text-decoration: underline;
    }

    .rec-album {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .rec-right {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-shrink: 0;
    }

    .rec-score {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        min-width: 32px;
        text-align: right;
    }

    .play-btn {
        background: var(--accent-primary);
        color: var(--accent-on-primary, #000);
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .rec-card:hover .play-btn,
    .rec-card:focus-visible .play-btn {
        opacity: 1;
    }

    .not-in-library {
        color: var(--text-tertiary);
        display: flex;
        align-items: center;
    }
</style>
