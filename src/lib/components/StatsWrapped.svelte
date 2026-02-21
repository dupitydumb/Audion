<script lang="ts">
    import { onMount } from "svelte";
    import { fade, slide, scale } from "svelte/transition";
    import {
        topTracks,
        topArtists,
        topAlbums,
        statsSummary,
    } from "$lib/stores/activity";
    import {
        getTrackCoverSrc,
        getAlbumArtSrc,
        type Track,
    } from "$lib/api/tauri";

    export let show = false;
    export let onClose: () => void = () => {};

    let currentSlide = 0;
    let canvas: HTMLCanvasElement;
    let isExporting = false;

    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    const currentMonthName = monthNames[new Date().getMonth()];

    const slides = [
        { id: "top-tracks", title: "Top Tracks" },
        { id: "top-artist", title: "Top Artist" },
        { id: "summary", title: "Your Month in Music" },
    ];

    function nextSlide() {
        if (currentSlide < slides.length - 1) {
            currentSlide++;
        }
    }

    function prevSlide() {
        if (currentSlide > 0) {
            currentSlide--;
        }
    }

    // Helper to format duration
    function formatMinutes(seconds: number): string {
        return Math.floor(seconds / 60).toLocaleString();
    }

    async function exportToImage() {
        if (!canvas) return;
        isExporting = true;

        try {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Set canvas size for Instagram Stories (1080x1920)
            canvas.width = 1080;
            canvas.height = 1920;

            // 1. Draw Background Gradient
            const grad = ctx.createLinearGradient(0, 0, 0, 1920);
            grad.addColorStop(0, "#1a1a1a");
            grad.addColorStop(1, "#000000");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1080, 1920);

            // Add some accent glow
            const accentGrad = ctx.createRadialGradient(
                540,
                960,
                0,
                540,
                960,
                1000,
            );
            accentGrad.addColorStop(0, "rgba(30, 215, 96, 0.1)"); // Spotify Green-ish
            accentGrad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = accentGrad;
            ctx.fillRect(0, 0, 1080, 1920);

            // 2. Draw Header
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 60px Inter, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("AUDION RECAP", 540, 180);

            // 3. Draw Content based on current slide
            if (currentSlide === 0) {
                await drawTopTracks(ctx);
            } else if (currentSlide === 1) {
                await drawTopArtist(ctx);
            } else {
                await drawSummary(ctx);
            }

            // 4. Draw Footer
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.font = "40px Inter, system-ui, sans-serif";
            ctx.fillText("Generated with Audion", 540, 1840);

            // 5. Save/Download
            const dataUrl = canvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = `audion-recap-${currentMonthName.toLowerCase()}-${slides[currentSlide].id}.png`;
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error("Export failed:", error);
        } finally {
            isExporting = false;
        }
    }

    async function drawTopTracks(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 80px Inter, system-ui, sans-serif";
        ctx.fillText("Your Top Tracks", 540, 350);

        const tracks = $topTracks.slice(0, 5);
        let y = 500;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i].track;
            // Draw rank
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            ctx.font = "italic bold 120px Inter, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(`#${i + 1}`, 100, y + 80);

            // Draw track name
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 50px Inter, sans-serif";
            ctx.fillText(track.title || "Unknown Title", 280, y + 40);

            // Draw artist
            ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
            ctx.font = "40px Inter, sans-serif";
            ctx.fillText(track.artist || "Unknown Artist", 280, y + 95);

            y += 200;
        }
    }

    async function drawTopArtist(ctx: CanvasRenderingContext2D) {
        const topArt = $topArtists[0];
        if (!topArt) return;

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 80px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Most Listened Artist", 540, 450);

        ctx.font = "bold 120px Inter, sans-serif";
        ctx.fillStyle = "#1ed760"; // Vibrant green
        ctx.fillText(topArt.artist.toString(), 540, 900);

        ctx.fillStyle = "#ffffff";
        ctx.font = "50px Inter, sans-serif";
        ctx.fillText(`${topArt.play_count} plays`, 540, 1050);
    }

    async function drawSummary(ctx: CanvasRenderingContext2D) {
        if (!$statsSummary) return;

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 80px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${currentMonthName} Recap`, 540, 500);

        // Minutes
        ctx.font = "bold 180px Inter, sans-serif";
        ctx.fillStyle = "#1ed760";
        ctx.fillText(
            formatMinutes($statsSummary.total_duration_seconds),
            540,
            750,
        );

        ctx.font = "bold 60px Inter, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("minutes of music", 540, 850);

        // Plays count
        ctx.font = "bold 180px Inter, sans-serif";
        ctx.fillStyle = "#1ed760";
        ctx.fillText($statsSummary.total_plays.toString(), 540, 1200);

        ctx.font = "bold 60px Inter, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("total plays", 540, 1300);
    }
</script>

{#if show}
    <div class="wrapped-overlay" transition:fade={{ duration: 300 }}>
        <div class="wrapped-container">
            <header class="header">
                <button class="close-btn" on:click={onClose}>
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
                <div class="progress-bars">
                    {#each slides as _, i}
                        <div
                            class="bar {i <= currentSlide ? 'active' : ''}"
                        ></div>
                    {/each}
                </div>
            </header>

            <main class="content-view">
                {#if currentSlide === 0}
                    <div class="slide" in:scale={{ duration: 400, start: 0.9 }}>
                        <h2 class="recap-title">Your Top Tracks</h2>
                        <div class="track-list">
                            {#each $topTracks.slice(0, 5) as item, i}
                                <div
                                    class="track-item"
                                    style="--delay: {i * 100}ms"
                                    in:slide={{ delay: i * 100 }}
                                >
                                    <span class="rank">#{i + 1}</span>
                                    <div class="track-info">
                                        <div class="name">
                                            {item.track.title}
                                        </div>
                                        <div class="artist">
                                            {item.track.artist}
                                        </div>
                                    </div>
                                    <span class="plays">{item.play_count}</span>
                                </div>
                            {/each}
                        </div>
                    </div>
                {:else if currentSlide === 1}
                    <div
                        class="slide hero-slide"
                        in:scale={{ duration: 400, start: 0.9 }}
                    >
                        <h2 class="recap-title">Top Artist</h2>
                        {#if $topArtists[0]}
                            <div class="hero-content">
                                <div class="artist-name">
                                    {$topArtists[0].artist}
                                </div>
                                <div class="artist-stats">
                                    {$topArtists[0].play_count} plays
                                </div>
                            </div>
                        {/if}
                    </div>
                {:else if currentSlide === 2}
                    <div
                        class="slide summary-slide"
                        in:scale={{ duration: 400, start: 0.9 }}
                    >
                        <h2 class="recap-title">{currentMonthName} Recap</h2>
                        {#if $statsSummary}
                            <div class="summary-grid">
                                <div class="stat-box">
                                    <div class="val">
                                        {formatMinutes(
                                            $statsSummary.total_duration_seconds,
                                        )}
                                    </div>
                                    <div class="lab">Minutes</div>
                                </div>
                                <div class="stat-box">
                                    <div class="val">
                                        {$statsSummary.total_plays}
                                    </div>
                                    <div class="lab">Plays</div>
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </main>

            <footer class="footer">
                <button
                    class="nav-btn"
                    disabled={currentSlide === 0}
                    on:click={prevSlide}
                >
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
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>

                <button
                    class="share-btn"
                    on:click={exportToImage}
                    disabled={isExporting}
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        width="20"
                        height="20"
                    >
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                    <span>{isExporting ? "Exporting..." : "Share Story"}</span>
                </button>

                <button
                    class="nav-btn"
                    disabled={currentSlide === slides.length - 1}
                    on:click={nextSlide}
                >
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
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
            </footer>
        </div>

        <!-- Hidden Canvas for export -->
        <canvas bind:this={canvas} style="display: none;"></canvas>
    </div>
{/if}

<style>
    .wrapped-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: black;
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .wrapped-container {
        width: 100%;
        max-width: 450px;
        height: 100%;
        max-height: 850px;
        background: linear-gradient(to bottom, #1a1a1a, #000000);
        display: flex;
        flex-direction: column;
        padding: var(--spacing-md);
        position: relative;
        overflow: hidden;
    }

    /* Portrait aspect ratio container for mobile/desktop parity */
    @media (min-width: 768px) {
        .wrapped-container {
            border-radius: var(--radius-lg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            aspect-ratio: 9/16;
            height: 90vh;
        }
    }

    .header {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) 0;
    }

    .progress-bars {
        display: flex;
        gap: 6px;
        height: 4px;
        padding: 0 var(--spacing-sm);
    }

    .bar {
        flex: 1;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
    }

    .bar.active {
        background: #1ed760;
    }

    .close-btn {
        align-self: flex-end;
        background: none;
        border: none;
        color: white;
        padding: var(--spacing-xs);
        cursor: pointer;
    }

    .content-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: var(--spacing-lg) var(--spacing-md);
    }

    .slide {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xl);
    }

    .recap-title {
        font-size: 2.5rem;
        font-weight: 800;
        text-align: center;
        background: linear-gradient(45deg, #fff, #1ed760);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .track-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
    }

    .track-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        background: rgba(255, 255, 255, 0.05);
        padding: var(--spacing-md);
        border-radius: var(--radius-md);
        backdrop-filter: blur(10px);
    }

    .rank {
        font-size: 1.5rem;
        font-weight: 900;
        color: rgba(255, 255, 255, 0.3);
        font-style: italic;
        min-width: 40px;
    }

    .track-info {
        flex: 1;
    }

    .track-info .name {
        font-weight: 700;
        font-size: 1.1rem;
    }

    .track-info .artist {
        font-size: 0.9rem;
        opacity: 0.7;
    }

    .plays {
        font-weight: 600;
        color: #1ed760;
    }

    .hero-slide {
        align-items: center;
        text-align: center;
    }

    .hero-content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .artist-name {
        font-size: 4rem;
        font-weight: 900;
        line-height: 1;
        color: #1ed760;
    }

    .artist-stats {
        font-size: 1.5rem;
        opacity: 0.8;
    }

    .summary-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--spacing-lg);
    }

    .stat-box {
        text-align: center;
    }

    .stat-box .val {
        font-size: 4rem;
        font-weight: 900;
        color: #1ed760;
    }

    .stat-box .lab {
        font-size: 1.2rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        opacity: 0.7;
    }

    .footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg) 0;
    }

    .nav-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .nav-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .share-btn {
        background: #1ed760;
        border: none;
        color: black;
        padding: var(--spacing-sm) var(--spacing-xl);
        border-radius: 30px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        cursor: pointer;
        transition: transform 0.2s;
    }

    .share-btn:active {
        transform: scale(0.95);
    }

    .share-btn:disabled {
        background: #555;
        cursor: not-allowed;
    }
</style>
