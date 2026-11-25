<script lang="ts">
    import { _, locale } from "svelte-i18n";
    import { onMount } from "svelte";
    import { formatTrackArtists } from "$lib/utils/artists";
    import { fade, slide, scale, fly } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import {
        topTracks,
        topArtists,
        topAlbums,
        statsSummary,
    } from "$lib/stores/activity";
    import {
        getAlbumArtSrc,
        getTopGenresFromMb,
        proxyFetchBytes,
        saveImageToGallery,
        type Track,
    } from "$lib/api/tauri";
    import { resolveTrackCover } from "$lib/stores/library";
    import Icon from "$lib/components/Icon.svelte";

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

    // Reset to first slide whenever reopened, and fetch data
    let wasShown = false;
    $: {
        if (show && !wasShown) {
            currentSlide = 0;
        }
        wasShown = show;
    }

    $: if (show && !genresFetched) fetchGenres();
    $: if (show && $topArtists[0])
        fetchArtistPicture($topArtists[0].artist.toString());

    function handleKeydown(e: KeyboardEvent) {
        if (!show) return;
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            nextSlide();
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            prevSlide();
        }
    }

    let swipeStartX = 0;
    let swipeStartY = 0;
    function handleSwipeStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
    }

    function handleSwipeEnd(e: TouchEvent) {
        if (e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - swipeStartX;
        const dy = e.changedTouches[0].clientY - swipeStartY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0) nextSlide();
            else prevSlide();
        }
    }

    const monthSlug = new Intl.DateTimeFormat("en", { month: "long" })
        .format(new Date())
        .toLowerCase();

    $: currentMonthName = new Intl.DateTimeFormat($locale || "en", {
        month: "long",
    })
        .format(new Date())
        .replace(/^./u, (c) => c.toUpperCase());

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
        if (playCount > 100) return $_('recap.labelObsession');
        if (playCount > 50) return $_('recap.labelDailyBread');
        if (playCount > 20) return $_('recap.labelMoodMaker');
        return $_('recap.labelNewDiscovery');
    }

    // fun facts based on minutes
    function getFunFact(minutes: number): string {
        if (minutes > 10000)
            return $_('recap.funFactMoon');
        if (minutes > 5000)
            return $_('recap.funFactLotr');
        if (minutes > 1000)
            return $_('recap.funFactGym');
        return $_('recap.funFactStarting');
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
            ctx.fillText("AUDION RECAP", 540, 120);

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
            ctx.fillText("AUDION", 540, 1820);

            const dataUrl = canvas.toDataURL("image/png");
            const base64Data = dataUrl.split(",")[1];
            const fileName = `audion-wrapped-${monthSlug}.png`;

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
        ctx.fillText($_("recap.your"), 540, 800);
        ctx.fillText(currentMonthName, 540, 950);
        ctx.fillText($_("recap.recapWord"), 540, 1100);
    }

    async function drawTopTracks(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 100px Inter, sans-serif";
        ctx.fillText($_("recap.yourTop"), 100, 300);
        ctx.fillText($_("recap.tracks"), 100, 410);

        const tracks = $topTracks.slice(0, 5);
        let y = 600;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i].track;
            const coverSrc = resolveTrackCover(track);

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
            ctx.fillText(track.title || $_("common.unknownTrack"), 300, y + 110);

            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.font = "32px Inter, sans-serif";
            ctx.fillText(formatTrackArtists(track) || $_("common.unknownArtist"), 300, y + 155);

            y += 240;
        }
    }

    async function drawTopArtist(ctx: CanvasRenderingContext2D) {
        const topArt = $topArtists[0];
        if (!topArt) return;

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 70px Inter, sans-serif";
        ctx.fillText($_("recap.numberOneArtist"), 540, 500);

        ctx.font = "900 140px Inter, sans-serif";
        ctx.fillText(topArt.artist.toString(), 540, 900);

        ctx.font = "bold 60px Inter, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(`${topArt.play_count} ${$_("recap.plays")}`, 540, 1100);

        ctx.font = "italic bold 50px Inter, sans-serif";
        ctx.fillText(getArtistLabel(topArt.play_count), 540, 1200);
    }

    async function drawSummary(ctx: CanvasRenderingContext2D) {
        if (!$statsSummary) return;

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 120px Inter, sans-serif";
        ctx.fillText($_("recap.yourMonth"), 540, 400);
        ctx.fillText($_("recap.inMusic"), 540, 530);

        ctx.font = "900 240px Inter, sans-serif";
        ctx.fillText(
            formatMinutes($statsSummary.total_duration_seconds),
            540,
            900,
        );

        ctx.font = "bold 60px Inter, sans-serif";
        ctx.fillText($_("recap.minutesListened").toUpperCase(), 540, 1000);

        ctx.font = "900 200px Inter, sans-serif";
        ctx.fillText($statsSummary.total_plays.toString(), 540, 1350);
        ctx.fillText($_("recap.totalPlays").toUpperCase(), 540, 1450);
    }

    async function drawGenreSlide(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 90px Inter, sans-serif";
        ctx.fillText($_("recap.yourSound").toUpperCase(), 540, 350);

        if (topGenres.length > 0) {
            const [topGenre] = topGenres[0];
            ctx.font = "900 180px Inter, sans-serif";
            ctx.fillStyle = "#a78bfa";
            ctx.fillText(topGenre, 540, 700);

            if (topGenres.length > 1) {
                ctx.font = "bold 60px Inter, sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText($_("recap.alsoInto"), 540, 900);
                topGenres.slice(1).forEach(([genre], i) => {
                    ctx.fillText(genre, 540, 990 + i * 90);
                });
            }
        } else {
            ctx.font = "bold 70px Inter, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillText($_("recap.genreEmptyLine1"), 540, 600);
            ctx.fillText($_("recap.genreEmptyLine2"), 540, 700);
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
        ctx.fillText($_("recap.recapYear", { values: { year } }), 540, cardY + 100);

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
        ctx.fillText($_("recap.topArtists").toUpperCase(), cardX + 80, textY);
        ctx.fillText($_("recap.topSongs").toUpperCase(), cardX + 450, textY);

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
            const titleText = item.track.title || $_("common.unknownTrack");
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
        ctx.fillText($_("recap.minutesListened").toUpperCase(), 540 - 200, footerY);
        ctx.fillText($_("recap.topGenre").toUpperCase(), 540 + 200, footerY);

        ctx.fillStyle = "#000000";
        ctx.font = "900 80px Inter, sans-serif";
        ctx.fillText(
            formatMinutes($statsSummary?.total_duration_seconds || 0),
            540 - 200,
            footerY + 80,
        );
        ctx.fillText(
            topGenres[0] ? topGenres[0][0] : $_("recap.musicFallback"),
            540 + 200,
            footerY + 80,
        );
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="wrapped-overlay" on:click={onClose} transition:fade={{ duration: 280 }}>
        <div
            class="wrapped-container slide-{currentSlide}"
            on:click|stopPropagation
            on:touchstart={handleSwipeStart}
            on:touchend={handleSwipeEnd}
        >
            <header class="header">
                <div class="progress-bars">
                    {#each slides as _, i}
                        <div class="bar" class:active={i <= currentSlide}></div>
                    {/each}
                </div>
                <div class="header-actions">
                    <button class="close-btn" on:click={onClose} aria-label="Close">
                        <Icon name="x" size={22} strokeWidth={2.5} />
                    </button>
                </div>
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
                                {$_('recap.yourRecap')}
                            </h2>
                            <p in:fly={{ y: 30, duration: 600, delay: 500 }}>
                                {$_('recap.aboardAudion', { values: { month: currentMonthName } })}
                            </p>
                        </div>
                    </div>
                {:else if currentSlide === 1}
                    <div
                        class="slide"
                        in:fly={{ x: 60, duration: 360, easing: cubicOut }}
                    >
                        <h2 class="slide-title">{$_('recap.topTracks')}</h2>
                        {#if $topTracks.length === 0}
                            <div class="recap-empty-state">
                                <Icon name="music" size={32} />
                                <p>{$_('recap.genreEmptyHint')}</p>
                            </div>
                        {:else}
                            <div class="track-stack">
                                {#each $topTracks.slice(0, 5) as item, i}
                                    <div
                                        class="premium-track-item"
                                        in:fly={{ y: 16, delay: i * 70 }}
                                    >
                                        <div class="track-rank-badge">{i + 1}</div>
                                        <div class="track-cover-wrapper">
                                            {#if resolveTrackCover(item.track)}
                                                <img
                                                    src={resolveTrackCover(
                                                        item.track,
                                                    )}
                                                    alt=""
                                                />
                                            {:else}
                                                <div class="cover-placeholder">
                                                    <Icon name="music" size={20} />
                                                </div>
                                            {/if}
                                        </div>
                                        <div class="track-meta">
                                            <div class="track-name">
                                                {item.track.title}
                                            </div>
                                            <div class="track-artist">
                                                {formatTrackArtists(item.track)}
                                            </div>
                                        </div>
                                        <div class="track-plays">
                                            {item.play_count} <small>{$_('recap.plays')}</small>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {:else if currentSlide === 2}
                    <div
                        class="slide artist-slide"
                        in:scale={{ duration: 420, start: 0.92, easing: cubicOut }}
                    >
                        {#if $topArtists[0]}
                            <span class="personality-label"
                                >{getArtistLabel(
                                    $topArtists[0]?.play_count || 0,
                                )}</span
                            >
                            <h2 class="slide-title">{$_('recap.mostListened')}</h2>
                            <div class="artist-hero">
                                <div class="artist-name-reveal">
                                    {$topArtists[0].artist}
                                </div>
                                <div class="artist-plays-hero">
                                    {$topArtists[0].play_count}
                                    <span>{$_('recap.playsThisMonth')}</span>
                                </div>
                            </div>
                        {:else}
                            <h2 class="slide-title">{$_('recap.mostListened')}</h2>
                            <div class="recap-empty-state">
                                <Icon name="user" size={32} />
                                <p>{$_('recap.genreEmptyHint')}</p>
                            </div>
                        {/if}
                    </div>
                {:else if currentSlide === 3}
                    <div
                        class="slide summary-slide"
                        in:fly={{ y: 100, duration: 500 }}
                    >
                        <h2 class="slide-title">{$_('recap.theNumbers')}</h2>
                        <div class="summary-visual">
                            <div class="stat-card primary">
                                <span class="stat-val"
                                    >{formatMinutes(
                                        $statsSummary?.total_duration_seconds ||
                                            0,
                                    )}</span
                                >
                                <span class="stat-label">{$_('recap.minutesListened')}</span>
                            </div>
                            <div class="stat-card secondary">
                                <span class="stat-val"
                                    >{$statsSummary?.total_plays || 0}</span
                                >
                                <span class="stat-label">{$_('recap.totalPlays')}</span>
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
                        <h2 class="slide-title">{$_('recap.yourSound')}</h2>
                        {#if genresLoading}
                            <div class="genre-loading">
                                <div class="genre-spinner"></div>
                                <span>{$_('recap.discoveringGenres')}</span>
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
                                {$_('recap.numberOneGenre')}
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
                                    <span class="also-label">{$_('recap.alsoInto')}</span>
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
                                    {$_('recap.genreEmptyHint')}
                                </p>
                            </div>
                        {/if}
                        <p class="mb-credit">{$_('recap.genresViaMusicBrainz')}</p>
                    </div>
                {:else if currentSlide === 5}
                    <div class="slide final-slide" in:fade={{ duration: 600 }}>
                        <div class="premium-recap-container">
                            <div class="premium-card">
                                <div class="card-logo-row">
                                    <h2 class="card-recap-title">
                                        {$_('recap.recapYear', { values: { year: new Date().getFullYear() } })}
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
                                            >{$_('recap.topArtists')}</span
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
                                        <span class="grid-label">{$_('recap.topSongs')}</span
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
                                            >{$_('recap.minutesListened')}</span
                                        >
                                        <span class="stat-value"
                                            >{formatMinutes(
                                                $statsSummary?.total_duration_seconds ||
                                                    0,
                                            )}</span
                                        >
                                    </div>
                                    <div class="footer-stat text-right">
                                        <span class="stat-label">{$_('recap.topGenre')}</span
                                        >
                                        <span class="stat-value"
                                            >{topGenres[0]
                                                ? topGenres[0][0]
                                                : $_('recap.musicFallback')}</span
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
                    <Icon name="chevron-left" size={28} strokeWidth={3} />
                </button>
                <button
                    class="share-btn"
                    on:click={exportToImage}
                    disabled={isExporting}
                >
                    <Icon name="download" size={20} strokeWidth={2.5} />
                    <span>{isExporting ? $_('recap.saving') : $_('recap.downloadImage')}</span>
                </button>
                <button
                    class="nav-btn"
                    disabled={currentSlide === slides.length - 1}
                    on:click={nextSlide}
                    aria-label="Next"
                >
                    <Icon name="chevron-right" size={28} strokeWidth={3} />
                </button>
            </footer>
        </div>
        <canvas bind:this={canvas} style="display: none;"></canvas>
    </div>
{/if}

<style>
    .wrapped-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.88);
        z-index: var(--z-dialog, 5000);
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: inherit;
    }

    .wrapped-container {
        width: 100%;
        max-width: 450px;
        height: 100dvh;
        display: flex;
        flex-direction: column;
        padding: var(--spacing-md) var(--spacing-lg);
        position: relative;
        overflow: hidden;
        color: #ffffff;
        background: #0a0a0c;
        transition: background 0.5s ease;
    }

    .slide-0,
    .slide-5 {
        background: radial-gradient(circle at 50% 15%, color-mix(in srgb, var(--accent-primary) 18%, #0a0a0c) 0%, #0a0a0c 70%);
    }
    .slide-1 {
        background: radial-gradient(circle at 10% 10%, color-mix(in srgb, var(--accent-primary) 22%, #0a0a0c) 0%, #0a0a0c 68%);
    }
    .slide-2 {
        background: radial-gradient(circle at 85% 85%, color-mix(in srgb, var(--accent-primary) 24%, #0a0a0c) 0%, #0a0a0c 68%);
    }
    .slide-3 {
        background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--accent-primary) 20%, #0a0a0c) 0%, #0a0a0c 70%);
    }
    .slide-4 {
        background: radial-gradient(circle at 25% 75%, color-mix(in srgb, var(--accent-primary) 22%, #0a0a0c) 0%, #0a0a0c 68%);
    }

    :global(html.layout-desktop) .wrapped-container {
        border-radius: 32px;
        aspect-ratio: 9/16;
        height: min(90dvh, 840px);
        max-width: min(460px, 92vw);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 32px 80px -16px rgba(0, 0, 0, 0.7);
    }

    .header {
        position: relative;
        z-index: 10;
        flex-shrink: 0;
        padding-top: calc(var(--spacing-xs) + var(--safe-area-top, 0px));
    }

    .header-actions {
        display: flex;
        justify-content: flex-end;
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
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #ffffff;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(10px);
        transition: background-color var(--transition-fast), transform 0.16s var(--ease-spring-snappy);
    }

    .close-btn:active {
        transform: scale(0.92);
    }

    .content-view {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        position: relative;
        z-index: 10;
        padding: var(--spacing-sm) 0;
    }

    .recap-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xl) var(--spacing-md);
        color: rgba(255, 255, 255, 0.72);
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: var(--radius-lg);
    }

    .recap-empty-state p {
        margin: 0;
        font-size: var(--font-size-base);
        line-height: 1.45;
        max-width: 28ch;
    }

    .slide {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
        max-height: 100%;
    }

    .intro-slide {
        align-items: center;
        text-align: center;
    }

    .logo-animation {
        position: relative;
        width: 120px;
        height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: var(--spacing-md);
    }

    .audion-orb {
        position: absolute;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, color-mix(in srgb, var(--accent-primary) 55%, transparent) 0%, transparent 70%);
        border-radius: 50%;
    }

    .hero-logo {
        position: relative;
        z-index: 2;
        width: 76px;
        height: 76px;
    }

    .intro-text h2 {
        font-size: clamp(2.1rem, 8vw, 3.1rem);
        font-weight: 900;
        letter-spacing: -0.03em;
        margin-bottom: 0.5rem;
        line-height: 1.05;
    }

    .slide-title {
        font-size: clamp(1.65rem, 6vw, 2.25rem);
        font-weight: 900;
        letter-spacing: -0.02em;
        line-height: 1.1;
    }

    .track-stack {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .premium-track-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        background: rgba(255, 255, 255, 0.06);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .track-rank-badge {
        font-size: 1.25rem;
        font-weight: 900;
        color: rgba(255, 255, 255, 0.55);
        width: 24px;
        text-align: center;
        flex-shrink: 0;
    }

    .track-cover-wrapper {
        width: 52px;
        height: 52px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .cover-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.6);
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
        font-weight: var(--font-weight-bold);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .track-artist {
        font-size: var(--font-size-xs);
        color: rgba(255, 255, 255, 0.72);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-plays {
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-sm);
        color: rgba(255, 255, 255, 0.9);
        flex-shrink: 0;
    }

    .artist-slide {
        align-items: center;
        text-align: center;
    }
    .personality-label {
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: var(--accent-primary);
        color: var(--text-on-accent, #000000);
        padding: 5px 14px;
        border-radius: var(--radius-full);
        font-weight: 800;
    }

    .artist-name-reveal {
        font-size: clamp(2.25rem, 9vw, 3.6rem);
        font-weight: 900;
        line-height: 0.98;
        margin: var(--spacing-lg) 0;
        word-break: break-word;
    }

    .stat-card {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        padding: var(--spacing-lg);
        border-radius: 20px;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin-bottom: var(--spacing-md);
    }

    .stat-val {
        font-size: clamp(2.5rem, 10vw, 3.5rem);
        font-weight: 900;
        line-height: 1.05;
    }
    .stat-label {
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: var(--font-size-xs);
        color: rgba(255, 255, 255, 0.72);
    }

    .fun-fact {
        font-size: 1rem;
        font-weight: var(--font-weight-semibold);
        color: var(--accent-primary);
        margin-top: var(--spacing-sm);
        line-height: 1.4;
    }

    .final-slide {
        flex: 1;
        min-height: 0;
        justify-content: center;
    }

    .premium-recap-container {
        width: 100%;
        max-height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .premium-card {
        width: 100%;
        max-height: 100%;
        overflow-y: auto;
        background: #ffffff;
        border-radius: 24px;
        color: #111111;
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
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
        width: min(68%, 220px);
        margin: 0 auto;
        aspect-ratio: 1;
        background: #16161a;
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .artist-initials {
        font-size: 3.25rem;
        font-weight: 900;
        color: #ffffff;
        text-transform: uppercase;
    }

    .card-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin: 6px 0;
    }

    .grid-col {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .grid-label {
        font-size: 0.7rem;
        font-weight: 800;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.65);
        margin-bottom: 4px;
    }

    .grid-item {
        display: flex;
        gap: 6px;
        font-size: var(--font-size-xs);
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
    }

    .grid-item .num {
        color: rgba(0, 0, 0, 0.5);
    }

    .grid-item .name {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .card-footer-stats {
        display: flex;
        justify-content: space-between;
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid rgba(0, 0, 0, 0.12);
    }

    .footer-stat {
        display: flex;
        flex-direction: column;
    }

    .footer-stat .stat-label {
        font-size: 0.65rem;
        font-weight: 800;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.65);
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
        font-size: clamp(2.25rem, 9vw, 3.25rem);
        font-weight: 900;
        line-height: 1.05;
        color: var(--accent-primary);
        margin: var(--spacing-md) 0 var(--spacing-xs);
        text-align: center;
    }

    .genre-label {
        font-size: var(--font-size-sm);
        color: rgba(255, 255, 255, 0.72);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: 0 0 var(--spacing-lg);
    }

    .genre-also {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .also-label {
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.65);
    }

    .genre-pill-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
    }

    .genre-pill {
        background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
        color: #ffffff;
        padding: 5px 14px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
    }

    .genre-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-md);
        color: rgba(255, 255, 255, 0.75);
        margin: var(--spacing-xl) 0;
    }

    .genre-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @media (prefers-reduced-motion: reduce) {
        .genre-spinner {
            animation: none !important;
        }
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .genre-empty {
        color: rgba(255, 255, 255, 0.72);
        text-align: center;
        margin: var(--spacing-xl) 0;
    }

    .mb-credit {
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.55);
        text-transform: uppercase;
        letter-spacing: 0.06em;
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
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) 0 calc(var(--spacing-sm) + var(--safe-area-bottom, 0px));
    }

    .nav-btn {
        background: rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #ffffff;
        width: 52px;
        height: 52px;
        min-width: 52px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background-color var(--transition-fast), transform 0.16s var(--ease-spring-snappy);
    }

    .nav-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.22);
        transform: scale(1.06);
    }

    .nav-btn:disabled {
        opacity: 0.25;
        cursor: not-allowed;
    }

    .share-btn {
        background: #ffffff;
        color: #111111;
        border: none;
        padding: 0 24px;
        height: 52px;
        border-radius: var(--radius-full);
        font-weight: 800;
        font-size: var(--font-size-base);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        white-space: nowrap;
        transition: transform 0.16s var(--ease-spring-snappy), background-color var(--transition-fast);
        box-shadow: var(--shadow-md);
    }

    .share-btn:hover:not(:disabled) {
        transform: translateY(-2px);
    }

    .share-btn:active {
        transform: scale(0.95);
    }
</style>
