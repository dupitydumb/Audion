<script lang="ts">
    import { onMount } from "svelte";
    import { fade, slide, scale, fly } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
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
        { id: "intro", title: "Your Recap" },
        { id: "top-tracks", title: "Top Tracks" },
        { id: "top-artist", title: "Top Artist" },
        { id: "summary", title: "Your Month in Music" },
        { id: "final-recap", title: "The Full Picture" },
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

    // fun personality labels for the top artist
    function getArtistLabel(playCount: number): string {
        if (playCount > 100) return "The Obesession";
        if (playCount > 50) return "The Daily Bread";
        if (playCount > 20) return "The Mood Maker";
        return "The New Discovery";
    }

    // fun facts based on minutes
    function getFunFact(minutes: number): string {
        if (minutes > 10000)
            return "You've listened enough to fly to the moon and back!";
        if (minutes > 5000)
            return "That's more time than it takes to watch every Lord of the Rings movie 5 times.";
        if (minutes > 1000)
            return "You've spent more time with us than most people spend at the gym.";
        return "You're just getting started on your musical journey!";
    }

    // Helper to format duration
    function formatMinutes(seconds: number): string {
        return Math.floor(seconds / 60).toLocaleString();
    }

    // Helper to load image for canvas
    function loadImage(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    async function exportToImage() {
        if (!canvas) return;
        isExporting = true;

        try {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // 1080x1920 is standard for IG stories
            canvas.width = 1080;
            canvas.height = 1920;

            // Premium Gradient Background
            const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
            grad.addColorStop(0, "#000000");
            grad.addColorStop(0.5, "#1a1a1a");
            grad.addColorStop(1, "#000000");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1080, 1920);

            // Vibrant mesh glow based on slide
            const meshGrad = ctx.createRadialGradient(
                540,
                960,
                0,
                540,
                960,
                1500,
            );
            if (currentSlide === 1) {
                // Top Tracks: Pink/Purple
                meshGrad.addColorStop(0, "rgba(255, 0, 128, 0.4)");
            } else if (currentSlide === 2) {
                // Top Artist: Cyan/Blue
                meshGrad.addColorStop(0, "rgba(0, 223, 216, 0.4)");
            } else {
                // Others: Green/Spotify vibes
                meshGrad.addColorStop(0, "rgba(30, 215, 96, 0.4)");
            }
            meshGrad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = meshGrad;
            ctx.fillRect(0, 0, 1080, 1920);

            // Header
            ctx.fillStyle = "#ffffff";
            ctx.font = "900 40px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("AUDION WRAPPED", 540, 120);

            // Draw content based on slide
            if (currentSlide === 0) await drawIntro(ctx);
            else if (currentSlide === 1) await drawTopTracks(ctx);
            else if (currentSlide === 2) await drawTopArtist(ctx);
            else if (currentSlide === 3) await drawSummary(ctx);
            else await drawFinalRecap(ctx);

            // Footer
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.font = "bold 32px Inter, sans-serif";
            ctx.fillText("LISTEN ON AUDIONPLAYER.COM", 540, 1820);

            const dataUrl = canvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = `audion-wrapped-${currentMonthName.toLowerCase()}.png`;
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error("Export failed:", error);
        } finally {
            isExporting = false;
        }
    }

    async function drawIntro(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 120px Inter, sans-serif";
        ctx.fillText("Your", 540, 800);
        ctx.fillText(currentMonthName, 540, 950);
        ctx.fillText("Recap", 540, 1100);
    }

    async function drawTopTracks(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 100px Inter, sans-serif";
        ctx.fillText("Your Top", 100, 300);
        ctx.fillText("Tracks", 100, 410);

        const tracks = $topTracks.slice(0, 5);
        let y = 600;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i].track;
            const coverSrc = getTrackCoverSrc(track);

            if (coverSrc) {
                try {
                    const img = await loadImage(coverSrc);
                    ctx.drawImage(img, 100, y, 160, 160);
                } catch {
                    ctx.fillStyle = "rgba(255,255,255,0.1)";
                    ctx.fillRect(100, y, 160, 160);
                }
            }

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 60px Inter, sans-serif";
            ctx.fillText((i + 1).toString(), 300, y + 60);

            ctx.font = "bold 48px Inter, sans-serif";
            ctx.fillText(track.title || "Unknown", 300, y + 110);

            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.font = "32px Inter, sans-serif";
            ctx.fillText(track.artist || "Unknown Artist", 300, y + 155);

            y += 240;
        }
    }

    async function drawTopArtist(ctx: CanvasRenderingContext2D) {
        const topArt = $topArtists[0];
        if (!topArt) return;

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 70px Inter, sans-serif";
        ctx.fillText("YOUR #1 ARTIST", 540, 500);

        ctx.font = "900 140px Inter, sans-serif";
        ctx.fillText(topArt.artist.toString(), 540, 900);

        ctx.font = "bold 60px Inter, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(`${topArt.play_count} Plays`, 540, 1100);

        ctx.font = "italic bold 50px Inter, sans-serif";
        ctx.fillText(getArtistLabel(topArt.play_count), 540, 1200);
    }

    async function drawSummary(ctx: CanvasRenderingContext2D) {
        if (!$statsSummary) return;

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 120px Inter, sans-serif";
        ctx.fillText("Your Month", 540, 400);
        ctx.fillText("in Music", 540, 530);

        ctx.font = "900 240px Inter, sans-serif";
        ctx.fillText(
            formatMinutes($statsSummary.total_duration_seconds),
            540,
            900,
        );

        ctx.font = "bold 60px Inter, sans-serif";
        ctx.fillText("MINUTES LISTENED", 540, 1000);

        ctx.font = "900 200px Inter, sans-serif";
        ctx.fillText($statsSummary.total_plays.toString(), 540, 1350);
        ctx.fillText("TOTAL PLAYS", 540, 1450);
    }

    async function drawFinalRecap(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 100px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("The Month", 540, 250);
        ctx.fillText("In Review", 540, 360);

        // Top Artist
        if ($topArtists[0]) {
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.font = "bold 32px Inter, sans-serif";
            ctx.fillText("YOUR #1 ARTIST", 540, 480);
            ctx.fillStyle = "#ffffff";
            ctx.font = "900 80px Inter, sans-serif";
            ctx.fillText($topArtists[0].artist.toString(), 540, 570);
        }

        // Top Songs List
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "bold 32px Inter, sans-serif";
        ctx.fillText("TOP SONGS", 100, 720);

        const tracks = $topTracks.slice(0, 5);
        let y = 790;
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i].track;
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 44px Inter, sans-serif";
            ctx.fillText(`${i + 1}. ${track.title}`, 100, y);
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.font = "32px Inter, sans-serif";
            ctx.fillText(track.artist || "", 150, y + 45);
            y += 110;
        }

        // Top Album
        if ($topAlbums[0]) {
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.font = "bold 32px Inter, sans-serif";
            ctx.fillText("TOP ALBUM", 540, 1420);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 50px Inter, sans-serif";
            ctx.fillText(String($topAlbums[0]?.album ?? "Unknown Album"), 540, 1490);
        }

        // Minutes & Plays Bottom
        if ($statsSummary) {
            ctx.textAlign = "center";
            ctx.font = "900 120px Inter, sans-serif";
            ctx.fillStyle = "#1ed760"; // Vibrant green for stats
            ctx.fillText(
                `${formatMinutes($statsSummary.total_duration_seconds)}`,
                300,
                1700,
            );
            ctx.fillText(`${$statsSummary.total_plays}`, 780, 1700);

            ctx.font = "900 28px Inter, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillText("MINUTES", 300, 1740);
            ctx.fillText("PLAYS", 780, 1740);
        }
    }
</script>

{#if show}
    <div class="wrapped-overlay" transition:fade={{ duration: 400 }}>
        <div class="wrapped-container slide-{currentSlide}">
            <header class="header">
                <div class="progress-bars">
                    {#each slides as _, i}
                        <div class="bar" class:active={i <= currentSlide}></div>
                    {/each}
                </div>
                <button class="close-btn" on:click={onClose} aria-label="Close">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                    >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </header>

            <main class="content-view">
                {#if currentSlide === 0}
                    <div
                        class="slide intro-slide"
                        in:scale={{
                            duration: 600,
                            start: 0.5,
                            easing: cubicOut,
                        }}
                    >
                        <div class="logo-animation">
                            <div class="audion-orb"></div>
                            <img src="/logo.png" alt="" class="hero-logo" />
                        </div>
                        <div class="intro-text">
                            <h2 in:fly={{ y: 50, duration: 600, delay: 300 }}>
                                Your Recap
                            </h2>
                            <p in:fly={{ y: 30, duration: 600, delay: 500 }}>
                                {currentMonthName} aboard Audion
                            </p>
                        </div>
                    </div>
                {:else if currentSlide === 1}
                    <div
                        class="slide"
                        in:fly={{ x: 100, duration: 500, easing: cubicOut }}
                    >
                        <h2 class="slide-title">Top Tracks</h2>
                        <div class="track-stack">
                            {#each $topTracks.slice(0, 5) as item, i}
                                <div
                                    class="premium-track-item"
                                    in:fly={{ y: 20, delay: i * 100 }}
                                >
                                    <div class="track-rank-badge">{i + 1}</div>
                                    <div class="track-cover-wrapper">
                                        {#if getTrackCoverSrc(item.track)}
                                            <img
                                                src={getTrackCoverSrc(
                                                    item.track,
                                                )}
                                                alt=""
                                            />
                                        {:else}
                                            <div class="cover-placeholder">
                                                ♪
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="track-meta">
                                        <div class="track-name">
                                            {item.track.title}
                                        </div>
                                        <div class="track-artist">
                                            {item.track.artist}
                                        </div>
                                    </div>
                                    <div class="track-plays">
                                        {item.play_count} <small>plays</small>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                {:else if currentSlide === 2}
                    <div
                        class="slide artist-slide"
                        in:scale={{ duration: 600, start: 0.8 }}
                    >
                        <span class="personality-label"
                            >{getArtistLabel(
                                $topArtists[0]?.play_count || 0,
                            )}</span
                        >
                        <h2 class="slide-title">Most Listened</h2>
                        {#if $topArtists[0]}
                            <div class="artist-hero">
                                <div class="artist-name-reveal">
                                    {$topArtists[0].artist}
                                </div>
                                <div class="artist-plays-hero">
                                    {$topArtists[0].play_count}
                                    <span>plays this month</span>
                                </div>
                            </div>
                        {/if}
                    </div>
                {:else if currentSlide === 3}
                    <div
                        class="slide summary-slide"
                        in:fly={{ y: 100, duration: 500 }}
                    >
                        <h2 class="slide-title">The Numbers</h2>
                        <div class="summary-visual">
                            <div class="stat-card primary">
                                <span class="stat-val"
                                    >{formatMinutes(
                                        $statsSummary?.total_duration_seconds ||
                                            0,
                                    )}</span
                                >
                                <span class="stat-label">Minutes Listened</span>
                            </div>
                            <div class="stat-card secondary">
                                <span class="stat-val"
                                    >{$statsSummary?.total_plays || 0}</span
                                >
                                <span class="stat-label">Total Plays</span>
                            </div>
                            <p class="fun-fact" in:fly={{ y: 20, delay: 400 }}>
                                {getFunFact(
                                    Math.floor(
                                        ($statsSummary?.total_duration_seconds ||
                                            0) / 60,
                                    ),
                                )}
                            </p>
                        </div>
                    </div>
                {:else if currentSlide === 4}
                    <div class="slide final-slide" in:fade={{ duration: 600 }}>
                        <div class="final-card">
                            <div class="final-header">
                                <img src="/logo.png" alt="" width="40" />
                                <span>Wrapped</span>
                            </div>
                            <div class="final-top-tracks">
                                {#each $topTracks.slice(0, 3) as item, i}
                                    <div class="final-track">
                                        <span class="num">{i + 1}</span>
                                        <span class="name"
                                            >{item.track.title}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                            <div class="final-footer">
                                <div>
                                    {formatMinutes(
                                        $statsSummary?.total_duration_seconds ||
                                            0,
                                    )} min
                                </div>
                                <div>
                                    {$statsSummary?.total_plays || 0} plays
                                </div>
                            </div>
                        </div>
                        <h3 class="share-prompt">Share your month!</h3>
                    </div>
                {/if}
            </main>

            <footer class="footer">
                <button
                    class="nav-btn"
                    disabled={currentSlide === 0}
                    on:click={prevSlide}
                    aria-label="Previous"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="28"
                        height="28"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
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
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                    >
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
                        ></path>
                        <polyline points="16 6 12 2 8 6"></polyline>
                        <line x1="12" y1="2" x2="12" y2="15"></line>
                    </svg>
                    <span>{isExporting ? "Saving..." : "Share Story"}</span>
                </button>
                <button
                    class="nav-btn"
                    disabled={currentSlide === slides.length - 1}
                    on:click={nextSlide}
                    aria-label="Next"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="28"
                        height="28"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                    >
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
            </footer>
        </div>
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
        background: #000;
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: "Inter", system-ui, sans-serif;
    }

    .wrapped-container {
        width: 100%;
        max-width: 450px;
        height: 100%;
        max-height: 850px;
        display: flex;
        flex-direction: column;
        padding: var(--spacing-lg);
        position: relative;
        overflow: hidden;
        color: white;
        background: #000;
        transition: background 0.8s ease;
    }

    .slide-0 {
        background: #000;
    }
    .slide-1 {
        background: radial-gradient(circle at 0% 0%, #301934, #000);
    }
    .slide-2 {
        background: radial-gradient(circle at 100% 100%, #1a2a6c, #000);
    }
    .slide-3 {
        background: radial-gradient(circle at center, #013220, #000);
    }
    .slide-4 {
        background: #000;
    }

    /* Animated orbs for depth */
    .wrapped-container::after {
        content: "";
        position: absolute;
        width: 300px;
        height: 300px;
        background: var(--accent-primary);
        filter: blur(100px);
        opacity: 0.2;
        border-radius: 50%;
        animation: drift 20s infinite alternate linear;
        pointer-events: none;
    }

    @keyframes drift {
        0% {
            transform: translate(-20%, -20%) scale(1);
        }
        100% {
            transform: translate(120%, 120%) scale(1.5);
        }
    }

    @media (min-width: 768px) {
        .wrapped-container {
            border-radius: 40px;
            aspect-ratio: 9/16;
            height: 90vh;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 50px 100px -20px rgba(0, 0, 0, 0.5);
        }
    }

    .header {
        position: relative;
        z-index: 10;
        padding-top: var(--spacing-sm);
    }

    .progress-bars {
        display: flex;
        gap: 6px;
        height: 4px;
        margin-bottom: var(--spacing-md);
    }

    .bar {
        flex: 1;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        overflow: hidden;
    }

    .bar.active {
        background: white;
    }

    .close-btn {
        float: right;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(10px);
    }

    .content-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        position: relative;
        z-index: 10;
    }

    .slide {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xl);
    }

    .intro-slide {
        align-items: center;
        text-align: center;
    }

    .logo-animation {
        position: relative;
        width: 140px;
        height: 140px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: var(--spacing-xl);
    }

    .audion-orb {
        position: absolute;
        width: 100%;
        height: 100%;
        background: linear-gradient(45deg, var(--accent-primary), #00ffff);
        border-radius: 50%;
        filter: blur(20px);
        animation: pulse 2s infinite ease-in-out;
    }

    @keyframes pulse {
        0%,
        100% {
            transform: scale(1);
            opacity: 0.5;
        }
        50% {
            transform: scale(1.2);
            opacity: 0.8;
        }
    }

    .hero-logo {
        position: relative;
        z-index: 2;
        width: 80px;
        height: 80px;
    }

    .intro-text h2 {
        font-size: 3.5rem;
        font-weight: 900;
        letter-spacing: -2px;
        margin-bottom: 0.5rem;
    }

    .slide-title {
        font-size: 2.5rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: -1px;
    }

    .track-stack {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
    }

    .premium-track-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        background: rgba(255, 255, 255, 0.05);
        padding: var(--spacing-sm);
        border-radius: 12px;
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .track-rank-badge {
        font-size: 1.5rem;
        font-weight: 900;
        opacity: 0.2;
        width: 30px;
    }

    .track-cover-wrapper {
        width: 56px;
        height: 56px;
        border-radius: 6px;
        overflow: hidden;
    }

    .track-cover-wrapper img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .track-meta {
        flex: 1;
        min-width: 0;
    }
    .track-name {
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .track-artist {
        font-size: 0.8rem;
        opacity: 0.6;
    }

    .artist-slide {
        align-items: center;
        text-align: center;
    }
    .personality-label {
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        background: var(--accent-primary);
        color: black;
        padding: 4px 12px;
        border-radius: 20px;
        font-weight: 800;
    }

    .artist-name-reveal {
        font-size: 4rem;
        font-weight: 900;
        line-height: 0.9;
        margin: var(--spacing-xl) 0;
    }

    .stat-card {
        background: rgba(255, 255, 255, 0.05);
        padding: var(--spacing-xl);
        border-radius: 24px;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: var(--spacing-lg);
    }

    .stat-val {
        font-size: 4rem;
        font-weight: 900;
    }
    .stat-label {
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.7;
    }

    .fun-fact {
        font-size: 1.1rem;
        font-weight: 600;
        font-style: italic;
        color: var(--accent-primary);
        margin-top: var(--spacing-md);
        text-shadow: 0 0 10px rgba(255, 0, 128, 0.3);
    }

    .final-card {
        background: white;
        color: black;
        padding: var(--spacing-xl);
        border-radius: 24px;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
    }

    .final-header {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 900;
        font-size: 1.2rem;
        margin-bottom: var(--spacing-sm);
    }

    .final-section {
        display: flex;
        flex-direction: column;
    }

    .section-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        font-weight: 800;
        opacity: 0.5;
        letter-spacing: 1px;
    }

    .hero-val {
        font-size: 1.8rem;
        font-weight: 900;
        line-height: 1;
        margin: 4px 0;
    }

    .sub-val {
        font-size: 1rem;
        font-weight: 700;
        margin: 2px 0;
    }

    .final-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 8px 0;
    }

    .final-list-item {
        display: flex;
        gap: 10px;
        font-size: 0.9rem;
        font-weight: 700;
    }

    .final-list-item .num {
        opacity: 0.3;
        width: 14px;
    }

    .final-footer {
        display: flex;
        justify-content: space-between;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
        padding-top: var(--spacing-md);
        margin-top: var(--spacing-sm);
    }

    .final-footer .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .final-footer .val {
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1;
    }

    .final-footer .lab {
        font-size: 0.7rem;
        text-transform: uppercase;
        font-weight: 800;
        opacity: 0.5;
    }

    .footer {
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg) 0;
    }

    .nav-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .share-btn {
        background: white;
        color: black;
        border: none;
        padding: 0 var(--spacing-xl);
        height: 56px;
        border-radius: 28px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
    }

    .share-btn:hover {
        transform: scale(1.05);
    }
    .share-btn:active {
        transform: scale(0.95);
    }
</style>
