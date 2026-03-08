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
        getTopGenresFromMb,
        proxyFetchBytes,
        saveImageToGallery,
        type Track,
    } from "$lib/api/tauri";

    export let show = false;
    export let onClose: () => void = () => {};

    let currentSlide = 0;
    let canvas: HTMLCanvasElement;
    let isExporting = false;

    // Genre data from MusicBrainz
    let topGenres: [string, number][] = [];
    let genresLoading = false;
    let genresFetched = false;

    async function fetchGenres() {
        if (genresFetched || genresLoading) return;
        genresLoading = true;
        try {
            topGenres = await getTopGenresFromMb(5);
        } catch (e) {
            console.warn("[StatsWrapped] Genre fetch failed:", e);
        } finally {
            genresLoading = false;
            genresFetched = true;
        }
    }

    // Artist picture handling
    let topArtistPictureUrl: string | null = null;
    let failedArtistImage = false;

    async function fetchArtistPicture(name: string) {
        if (!name) return;
        try {
            const plugin = (window as any).tidalSearchPlugin;
            if (plugin) {
                const result = await plugin.searchArtistPictureForRPC(name);
                if (result) {
                    topArtistPictureUrl = result;
                    failedArtistImage = false;
                }
            }
        } catch (e) {
            console.warn("[StatsWrapped] Artist picture fetch failed:", e);
        }
    }

    // Start fetching genres and artist picture as soon as the wrapped opens
    $: if (show && !genresFetched) fetchGenres();
    $: if (show && $topArtists[0])
        fetchArtistPicture($topArtists[0].artist.toString());

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
        { id: "top-genre", title: "Your Sound" },
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
    async function loadImage(src: string): Promise<HTMLImageElement> {
        // If it's a remote URL, fetch via proxy to bypass CORS
        let finalSrc = src;
        if (src.startsWith("http") && !src.includes("tauri.localhost")) {
            try {
                const base64 = await proxyFetchBytes(src);
                // Determine mime type from URL or default to jpeg
                const ext = src.split(".").pop()?.toLowerCase();
                const mime = ext === "png" ? "image/png" : "image/jpeg";
                finalSrc = `data:${mime};base64,${base64}`;
            } catch (e) {
                console.warn(
                    "[StatsWrapped] Proxy fetch failed for image:",
                    src,
                    e,
                );
            }
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = finalSrc;
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
            else if (currentSlide === 4) await drawGenreSlide(ctx);
            else await drawFinalRecap(ctx);

            // Footer
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.font = "bold 32px Inter, sans-serif";
            ctx.fillText("LISTEN ON AUDIONPLAYER.COM", 540, 1820);

            const dataUrl = canvas.toDataURL("image/png");
            const base64Data = dataUrl.split(",")[1];
            const fileName = `audion-wrapped-${currentMonthName.toLowerCase()}.png`;

            await saveImageToGallery(base64Data, fileName);
            // Optional: You could show a "Saved to gallery" toast here if available
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

    async function drawGenreSlide(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 90px Inter, sans-serif";
        ctx.fillText("YOUR SOUND", 540, 350);

        if (topGenres.length > 0) {
            const [topGenre] = topGenres[0];
            ctx.font = "900 180px Inter, sans-serif";
            ctx.fillStyle = "#a78bfa";
            ctx.fillText(topGenre, 540, 700);

            if (topGenres.length > 1) {
                ctx.font = "bold 60px Inter, sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("Also into:", 540, 900);
                topGenres.slice(1).forEach(([genre], i) => {
                    ctx.fillText(genre, 540, 990 + i * 90);
                });
            }
        } else {
            ctx.font = "bold 70px Inter, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillText("Play more music", 540, 600);
            ctx.fillText("to discover your genre!", 540, 700);
        }
    }

    async function drawFinalRecap(ctx: CanvasRenderingContext2D) {
        const year = new Date().getFullYear().toString();
        const mainColor = "#fa243c"; // Apple Music Red
        const bgColor = "#0a0a0a";

        // 1. Smooth Mesh Gradient Background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 1080, 1920);

        // Radial Top Left
        const gradTL = ctx.createRadialGradient(200, 200, 0, 200, 200, 1000);
        gradTL.addColorStop(0, "rgba(250, 36, 60, 0.4)");
        gradTL.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradTL;
        ctx.fillRect(0, 0, 1080, 1920);

        // Radial Bottom Right
        const gradBR = ctx.createRadialGradient(880, 1720, 0, 880, 1720, 1000);
        gradBR.addColorStop(0, "rgba(64, 156, 255, 0.3)");
        gradBR.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradBR;
        ctx.fillRect(0, 0, 1080, 1920);

        // 2. Centered Main Card
        const cardWidth = 850;
        const cardHeight = 1500;
        const cardX = (1080 - cardWidth) / 2;
        const cardY = (1920 - cardHeight) / 2;

        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = 60;
        ctx.shadowOffsetY = 30;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 60);
        ctx.fill();
        ctx.restore();

        // 3. Card Header (Branding)
        ctx.textAlign = "center";
        ctx.fillStyle = "#000000";
        ctx.font = "900 36px Inter, sans-serif";
        ctx.fillText("RECAP " + year, 540, cardY + 100);

        try {
            const logoImg = await loadImage("/logo.png");
            ctx.drawImage(logoImg, 540 - 30, cardY + 130, 60, 60);
        } catch (e) {}

        // 4. Visual Piece
        const imgSize = 580; // Reduced from 650
        const imgX = (1080 - imgSize) / 2;
        const imgY = cardY + 200; // Moved up slightly

        if ($topArtists[0]) {
            if (topArtistPictureUrl && !failedArtistImage) {
                try {
                    const img = await loadImage(topArtistPictureUrl);
                    ctx.save();
                    ctx.beginPath();
                    ctx.roundRect(imgX, imgY, imgSize, imgSize, 20);
                    ctx.clip();
                    ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
                    ctx.restore();
                } catch {
                    ctx.fillStyle = mainColor;
                    ctx.beginPath();
                    ctx.roundRect(imgX, imgY, imgSize, imgSize, 20);
                    ctx.fill();
                }
            } else {
                ctx.fillStyle = mainColor;
                ctx.beginPath();
                ctx.roundRect(imgX, imgY, imgSize, imgSize, 20);
                ctx.fill();
            }
        }

        // 5. Grid Stats
        ctx.textAlign = "left";
        let textY = imgY + imgSize + 80; // Reduced gap

        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.font = "bold 28px Inter, sans-serif";
        ctx.fillText("TOP ARTISTS", cardX + 80, textY);
        ctx.fillText("TOP SONGS", cardX + 450, textY);

        ctx.fillStyle = "#000000";
        ctx.font = "900 38px Inter, sans-serif"; // Slightly smaller font

        $topArtists.slice(0, 5).forEach((art, i) => {
            const name =
                art.artist.toString().length > 15
                    ? art.artist.toString().substring(0, 12) + "..."
                    : art.artist;
            ctx.fillText(`${i + 1} ${name}`, cardX + 80, textY + 60 + i * 50); // Reduced line height
        });

        $topTracks.slice(0, 5).forEach((item, i) => {
            const titleText = item.track.title || "Unknown Track";
            const title =
                titleText.length > 20
                    ? titleText.substring(0, 17) + "..."
                    : titleText; // More space for titles
            ctx.fillText(`${i + 1} ${title}`, cardX + 450, textY + 60 + i * 50); // Reduced line height
        });

        // 6. Footer Stats
        const footerY = cardY + cardHeight - 220; // Moved up more to clear buttons
        ctx.textAlign = "center";

        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.font = "bold 28px Inter, sans-serif";
        ctx.fillText("MINUTES LISTENED", 540 - 200, footerY);
        ctx.fillText("TOP GENRE", 540 + 200, footerY);

        ctx.fillStyle = "#000000";
        ctx.font = "900 80px Inter, sans-serif";
        ctx.fillText(
            formatMinutes($statsSummary?.total_duration_seconds || 0),
            540 - 200,
            footerY + 80,
        );
        ctx.fillText(
            topGenres[0] ? topGenres[0][0] : "Music",
            540 + 200,
            footerY + 80,
        );
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
                    <!-- ── Genre slide (MusicBrainz) ── -->
                    <div
                        class="slide genre-slide"
                        in:scale={{
                            duration: 600,
                            start: 0.8,
                            easing: cubicOut,
                        }}
                    >
                        <h2 class="slide-title">Your Sound</h2>
                        {#if genresLoading}
                            <div class="genre-loading">
                                <div class="genre-spinner"></div>
                                <span>Discovering your genres…</span>
                            </div>
                        {:else if topGenres.length > 0}
                            <div
                                class="top-genre-name"
                                in:fly={{ y: 40, duration: 600, delay: 200 }}
                            >
                                {topGenres[0][0]}
                            </div>
                            <p
                                class="genre-label"
                                in:fly={{ y: 20, duration: 500, delay: 400 }}
                            >
                                is your #1 genre
                            </p>
                            {#if topGenres.length > 1}
                                <div
                                    class="genre-also"
                                    in:fly={{
                                        y: 20,
                                        duration: 500,
                                        delay: 600,
                                    }}
                                >
                                    <span class="also-label">Also into:</span>
                                    <div class="genre-pill-row">
                                        {#each topGenres.slice(1) as [genre], i}
                                            <span
                                                class="genre-pill"
                                                in:fly={{
                                                    x: 20,
                                                    delay: 700 + i * 100,
                                                }}>{genre}</span
                                            >
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        {:else}
                            <div class="genre-empty">
                                <p>
                                    Keep listening to uncover your genre
                                    identity!
                                </p>
                            </div>
                        {/if}
                        <p class="mb-credit">Genres via MusicBrainz</p>
                    </div>
                {:else if currentSlide === 5}
                    <div class="slide final-slide" in:fade={{ duration: 600 }}>
                        <div class="premium-recap-container">
                            <div class="premium-card">
                                <div class="card-logo-row">
                                    <h2 class="card-recap-title">
                                        RECAP {new Date().getFullYear()}
                                    </h2>
                                    <img
                                        src="/logo.png"
                                        alt=""
                                        class="card-logo"
                                    />
                                </div>

                                <div class="card-image-box">
                                    {#if topArtistPictureUrl && !failedArtistImage}
                                        <img
                                            src={topArtistPictureUrl}
                                            alt=""
                                            class="artist-img-recap"
                                            on:error={() =>
                                                (failedArtistImage = true)}
                                        />
                                    {:else if $topArtists[0]}
                                        <div class="artist-initials">
                                            {$topArtists[0].artist
                                                .toString()
                                                .substring(0, 2)}
                                        </div>
                                    {/if}
                                </div>

                                <div class="card-grid">
                                    <div class="grid-col">
                                        <span class="grid-label"
                                            >Top Artists</span
                                        >
                                        {#each $topArtists.slice(0, 5) as art, i}
                                            <div class="grid-item">
                                                <span class="num">{i + 1}</span>
                                                <span class="name"
                                                    >{art.artist}</span
                                                >
                                            </div>
                                        {/each}
                                    </div>
                                    <div class="grid-col">
                                        <span class="grid-label">Top Songs</span
                                        >
                                        {#each $topTracks.slice(0, 5) as item, i}
                                            <div class="grid-item">
                                                <span class="num">{i + 1}</span>
                                                <span class="name"
                                                    >{item.track.title}</span
                                                >
                                            </div>
                                        {/each}
                                    </div>
                                </div>

                                <div class="card-footer-stats">
                                    <div class="footer-stat">
                                        <span class="stat-label"
                                            >Minutes Listened</span
                                        >
                                        <span class="stat-value"
                                            >{formatMinutes(
                                                $statsSummary?.total_duration_seconds ||
                                                    0,
                                            )}</span
                                        >
                                    </div>
                                    <div class="footer-stat text-right">
                                        <span class="stat-label">Top Genre</span
                                        >
                                        <span class="stat-value"
                                            >{topGenres[0]
                                                ? topGenres[0][0]
                                                : "Music"}</span
                                        >
                                    </div>
                                </div>
                            </div>
                        </div>
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
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>{isExporting ? "Saving..." : "Download Image"}</span>
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
        background: radial-gradient(circle at 30% 70%, #2d1b69, #000);
    }
    .slide-5 {
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

    .premium-recap-container {
        position: absolute;
        inset: 0;
        background: transparent;
        overflow: hidden;
        display: flex;
        justify-content: center;
        z-index: 1;
    }

    .apple-style {
        background: radial-gradient(circle at 0% 0%, #fa243c, transparent 60%),
            radial-gradient(circle at 100% 100%, #409cff, transparent 60%),
            #0a0a0a;
    }

    .premium-card {
        width: 85%;
        height: 90%;
        background: #ffffff;
        border-radius: 32px;
        color: black;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        position: relative;
        z-index: 2;
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
    }

    .card-logo-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
    }

    .card-recap-title {
        font-size: 1.2rem;
        font-weight: 900;
        letter-spacing: 2px;
        margin: 0;
    }

    .card-logo {
        width: 32px;
        height: 32px;
    }

    .card-image-box {
        width: 85%;
        margin: 0 auto;
        aspect-ratio: 1;
        background: #f0f0f0;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .artist-initials {
        font-size: 4rem;
        font-weight: 900;
        color: white;
        text-transform: uppercase;
    }

    .card-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin: 10px 0;
    }

    .grid-col {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .grid-label {
        font-size: 0.65rem;
        font-weight: 800;
        text-transform: uppercase;
        opacity: 0.4;
        margin-bottom: 4px;
    }

    .grid-item {
        display: flex;
        gap: 6px;
        font-size: 0.75rem;
        font-weight: 900;
        white-space: nowrap;
        overflow: hidden;
    }

    .grid-item .num {
        opacity: 0.3;
    }

    .grid-item .name {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .card-footer-stats {
        display: flex;
        justify-content: space-between;
        margin-top: auto;
        padding-top: 15px;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
    }

    .footer-stat {
        display: flex;
        flex-direction: column;
    }

    .footer-stat .stat-label {
        font-size: 0.6rem;
        font-weight: 800;
        text-transform: uppercase;
        opacity: 0.4;
    }

    .footer-stat .stat-value {
        font-size: 1.2rem;
        font-weight: 900;
        line-height: 1.1;
    }

    .text-right {
        text-align: right;
    }

    .card-branding {
        font-size: 0.5rem;
        font-weight: 900;
        text-align: center;
        opacity: 0.2;
        letter-spacing: 1px;
    }

    /* ── Genre slide ── */
    .genre-slide {
        align-items: center;
        text-align: center;
        justify-content: center;
    }

    .top-genre-name {
        font-size: 3.5rem;
        font-weight: 900;
        line-height: 1;
        background: linear-gradient(135deg, #a78bfa, #60a5fa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin: var(--spacing-lg) 0 var(--spacing-sm);
        text-align: center;
    }

    .genre-label {
        font-size: 1rem;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin: 0 0 var(--spacing-xl);
    }

    .genre-also {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .also-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        opacity: 0.5;
    }

    .genre-pill-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
    }

    .genre-pill {
        background: rgba(167, 139, 250, 0.2);
        border: 1px solid rgba(167, 139, 250, 0.4);
        color: #c4b5fd;
        padding: 4px 14px;
        border-radius: 20px;
        font-size: 0.875rem;
        font-weight: 600;
    }

    .genre-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-md);
        opacity: 0.6;
        margin: var(--spacing-xl) 0;
    }

    .genre-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: #a78bfa;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .genre-empty {
        opacity: 0.5;
        text-align: center;
        margin: var(--spacing-xl) 0;
    }

    .mb-credit {
        font-size: 0.65rem;
        opacity: 0.3;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-top: auto;
    }

    .artist-img-recap {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
    }

    .footer {
        z-index: 100;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 var(--spacing-lg) var(--spacing-xl);
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        pointer-events: none;
    }

    .footer button {
        pointer-events: auto;
    }

    .nav-btn {
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .nav-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.25);
        transform: scale(1.1);
    }

    .nav-btn:disabled {
        opacity: 0.2;
        cursor: not-allowed;
    }

    .share-btn {
        background: white;
        color: black;
        border: none;
        padding: 0 40px;
        height: 60px;
        border-radius: 30px;
        font-weight: 900;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    }

    .share-btn:hover:not(:disabled) {
        transform: translateY(-4px) scale(1.02);
        box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
    }

    .share-btn:active {
        transform: scale(0.95);
    }
</style>
