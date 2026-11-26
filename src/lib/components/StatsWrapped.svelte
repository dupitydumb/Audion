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
    let recapPreviewCanvas: HTMLCanvasElement;
    let isExporting = false;

    type RecapTheme = "frosted" | "vinyl" | "mesh" | "minimal";
    type RecapAspect = "9:16" | "1:1";

    const recapThemes: { id: RecapTheme; label: string }[] = [
        { id: "frosted", label: "Frosted" },
        { id: "vinyl", label: "Vinyl" },
        { id: "mesh", label: "Mesh" },
        { id: "minimal", label: "Minimal" },
    ];

    let recapTheme: RecapTheme = "frosted";
    let recapAspect: RecapAspect = "9:16";

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

    // Album cover collage / hero art for shareable recap (replaces unreliable external artist pics)
    let failedCoverUrls = new Set<string>();
    $: recapCovers = (() => {
        const urls: string[] = [];
        const seen = new Set<string>();
        const pushUrl = (u: string | null | undefined) => {
            if (!u || seen.has(u) || failedCoverUrls.has(u)) return;
            seen.add(u);
            urls.push(u);
        };
        for (const alb of $topAlbums) {
            if (urls.length >= 4) break;
            if (alb.album_art) pushUrl(getAlbumArtSrc(alb.album_art));
        }
        for (const item of $topTracks) {
            if (urls.length >= 4) break;
            pushUrl(resolveTrackCover(item.track));
        }
        return urls;
    })();

    // Reset to first slide whenever reopened, and fetch data
    let wasShown = false;
    $: {
        if (show && !wasShown) {
            currentSlide = 0;
        }
        wasShown = show;
    }

    $: if (show && !genresFetched) fetchGenres();

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

    function isTauriAssetUrl(src: string): boolean {
        return (
            src.startsWith("asset:") ||
            /\/\/(asset|tauri)\.localhost(?::\d+)?\//i.test(src)
        );
    }

    function blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    const imageCache = new Map<string, HTMLImageElement>();

    // Helper to load image for canvas (cached, fast-path for Tauri asset URLs)
    async function loadImage(src: string): Promise<HTMLImageElement> {
        const cached = imageCache.get(src);
        if (cached) return cached;

        let finalSrc = src;
        if (isTauriAssetUrl(src)) {
            try {
                const resp = await fetch(src);
                if (resp.ok) {
                    finalSrc = await blobToDataUrl(await resp.blob());
                }
            } catch {
                // Fall back to direct URL if fetch fails
            }
        } else if (src.startsWith("http")) {
            try {
                const base64 = await proxyFetchBytes(src);
                const ext = src.split(".").pop()?.toLowerCase();
                const mime = ext === "png" ? "image/png" : "image/jpeg";
                finalSrc = `data:${mime};base64,${base64}`;
            } catch (e) {
                console.warn("[StatsWrapped] Proxy fetch failed for image:", src, e);
            }
        }

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = "anonymous";
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = finalSrc;
        });
        imageCache.set(src, img);
        return img;
    }

    async function exportToImage() {
        if (!canvas) return;
        isExporting = true;

        try {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // 1080x1920 is standard for IG stories; 1080x1080 for square summary posts
            const exportWidth = 1080;
            const exportHeight =
                currentSlide === 5 && recapAspect === "1:1" ? 1080 : 1920;
            canvas.width = exportWidth;
            canvas.height = exportHeight;

            if (currentSlide === 5) {
                await drawFinalRecap(ctx, exportWidth, exportHeight);
            } else {
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
                    meshGrad.addColorStop(0, "rgba(255, 0, 128, 0.4)");
                } else if (currentSlide === 2) {
                    meshGrad.addColorStop(0, "rgba(0, 223, 216, 0.4)");
                } else {
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

                if (currentSlide === 0) await drawIntro(ctx);
                else if (currentSlide === 1) await drawTopTracks(ctx);
                else if (currentSlide === 2) await drawTopArtist(ctx);
                else if (currentSlide === 3) await drawSummary(ctx);
                else if (currentSlide === 4) await drawGenreSlide(ctx);

                // Footer
                ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                ctx.font = "bold 32px Inter, sans-serif";
                ctx.fillText("AUDION", 540, 1820);
            }

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

    async function drawFinalRecap(
        ctx: CanvasRenderingContext2D,
        width = 1080,
        height = 1920,
    ) {
        const year = new Date().getFullYear().toString();
        const isSquare = height === 1080;
        const cssAccent =
            typeof window !== "undefined"
                ? getComputedStyle(document.documentElement)
                      .getPropertyValue("--accent-primary")
                      .trim()
                : "";
        const accentColor = cssAccent || "#1db954";

        const loadedCovers = (
            await Promise.all(
                recapCovers.slice(0, 4).map((url) => loadImage(url).catch(() => null)),
            )
        ).filter((img): img is HTMLImageElement => img !== null);

        // Backdrop by template
        ctx.fillStyle = recapTheme === "minimal" ? "#0d0e12" : "#08090e";
        ctx.fillRect(0, 0, width, height);

        if (recapTheme === "frosted" && loadedCovers[0]) {
            ctx.save();
            const scale =
                Math.max(
                    width / loadedCovers[0].width,
                    height / loadedCovers[0].height,
                ) * 1.15;
            const sw = loadedCovers[0].width * scale;
            const sh = loadedCovers[0].height * scale;
            ctx.filter = "blur(70px) brightness(0.32) saturate(1.5)";
            ctx.drawImage(
                loadedCovers[0],
                (width - sw) / 2,
                (height - sh) / 2,
                sw,
                sh,
            );
            ctx.restore();
        } else if (recapTheme === "mesh") {
            const gradTL = ctx.createRadialGradient(
                width * 0.2,
                height * 0.16,
                0,
                width * 0.2,
                height * 0.16,
                width * 0.85,
            );
            gradTL.addColorStop(0, accentColor + "66");
            gradTL.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = gradTL;
            ctx.fillRect(0, 0, width, height);

            const gradBR = ctx.createRadialGradient(
                width * 0.82,
                height * 0.84,
                0,
                width * 0.82,
                height * 0.84,
                width * 0.8,
            );
            gradBR.addColorStop(0, "rgba(72, 132, 255, 0.34)");
            gradBR.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = gradBR;
            ctx.fillRect(0, 0, width, height);
        } else if (recapTheme === "vinyl") {
            const studioGlow = ctx.createRadialGradient(
                width / 2,
                height * 0.35,
                0,
                width / 2,
                height * 0.35,
                width * 0.75,
            );
            studioGlow.addColorStop(0, "rgba(255, 255, 255, 0.08)");
            studioGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = studioGlow;
            ctx.fillRect(0, 0, width, height);
        } else if (recapTheme === "minimal") {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
            ctx.lineWidth = 2;
            ctx.strokeRect(36, 36, width - 72, height - 72);
        }

        // Card surface
        const cardX = isSquare ? 72 : 88;
        const cardY = isSquare ? 72 : 168;
        const cardW = width - cardX * 2;
        const cardH = height - cardY * 2;

        if (recapTheme !== "minimal") {
            ctx.save();
            ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
            ctx.shadowBlur = 64;
            ctx.shadowOffsetY = 24;
            ctx.fillStyle =
                recapTheme === "frosted"
                    ? "rgba(18, 20, 28, 0.72)"
                    : recapTheme === "vinyl"
                      ? "#131419"
                      : "rgba(16, 17, 24, 0.82)";
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 44);
            ctx.fill();
            ctx.restore();

            ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 44);
            ctx.stroke();
        }

        const pad = isSquare ? 48 : 64;
        const innerX = cardX + pad;
        const innerW = cardW - pad * 2;

        // Header row
        ctx.textAlign = "left";
        ctx.fillStyle = accentColor;
        ctx.font = "900 24px Inter, sans-serif";
        ctx.fillText(
            $_("recap.recapYear", { values: { year } }).toUpperCase(),
            innerX,
            cardY + (isSquare ? 56 : 74),
        );

        try {
            const logoImg = await loadImage("/logo.png");
            const logoSize = isSquare ? 42 : 50;
            ctx.drawImage(
                logoImg,
                cardX + cardW - pad - logoSize,
                cardY + (isSquare ? 30 : 44),
                logoSize,
                logoSize,
            );
        } catch {}

        // Visual hero block (Album collage, single cover, or Vinyl sleeve + disc)
        const artSize = isSquare ? 260 : 450;
        const artY = cardY + (isSquare ? 94 : 132);
        const artX =
            recapTheme === "vinyl"
                ? innerX + (isSquare ? 24 : 76)
                : (width - artSize) / 2;

        if (recapTheme === "vinyl") {
            // Vinyl record peeking out to the right of the sleeve
            const discR = artSize * 0.46;
            const discCx = artX + artSize * 0.92;
            const discCy = artY + artSize / 2;

            ctx.save();
            ctx.fillStyle = "#0a0a0c";
            ctx.beginPath();
            ctx.arc(discCx, discCy, discR, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "rgba(255,255,255,0.09)";
            ctx.lineWidth = 2;
            for (const rFrac of [0.85, 0.72, 0.58]) {
                ctx.beginPath();
                ctx.arc(discCx, discCy, discR * rFrac, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.arc(discCx, discCy, discR * 0.28, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#0a0a0c";
            ctx.beginPath();
            ctx.arc(discCx, discCy, discR * 0.08, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        if (loadedCovers.length >= 4 && recapTheme !== "vinyl") {
            const gap = isSquare ? 8 : 14;
            const cell = (artSize - gap) / 2;
            const positions = [
                [artX, artY],
                [artX + cell + gap, artY],
                [artX, artY + cell + gap],
                [artX + cell + gap, artY + cell + gap],
            ];
            for (let i = 0; i < 4; i++) {
                const [cx, cy] = positions[i];
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(cx, cy, cell, cell, 16);
                ctx.clip();
                ctx.drawImage(loadedCovers[i], cx, cy, cell, cell);
                ctx.restore();
            }
        } else if (loadedCovers.length >= 1) {
            ctx.save();
            ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
            ctx.shadowBlur = 32;
            ctx.beginPath();
            ctx.roundRect(artX, artY, artSize, artSize, 22);
            ctx.clip();
            ctx.drawImage(loadedCovers[0], artX, artY, artSize, artSize);
            ctx.restore();
        } else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
            ctx.beginPath();
            ctx.roundRect(artX, artY, artSize, artSize, 22);
            ctx.fill();
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(artX + artSize / 2, artY + artSize / 2, artSize * 0.24, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Top artists and songs columns
        const listY = artY + artSize + (isSquare ? 44 : 74);
        const col1X = innerX;
        const col2X = innerX + innerW * 0.52;
        const rowStep = isSquare ? 42 : 56;
        const fontSize = isSquare ? 24 : 30;

        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = `800 ${isSquare ? 18 : 22}px Inter, sans-serif`;
        ctx.fillText($_("recap.topArtists").toUpperCase(), col1X, listY);
        ctx.fillText($_("recap.topSongs").toUpperCase(), col2X, listY);

        $topArtists.slice(0, 5).forEach((art, i) => {
            const y = listY + (isSquare ? 40 : 56) + i * rowStep;
            ctx.fillStyle = accentColor;
            ctx.font = `900 ${fontSize}px Inter, sans-serif`;
            ctx.fillText(`${i + 1}`, col1X, y);

            const raw = art.artist.toString();
            const name = raw.length > 15 ? raw.substring(0, 13) + "…" : raw;
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 ${fontSize}px Inter, sans-serif`;
            ctx.fillText(name, col1X + 34, y);
        });

        $topTracks.slice(0, 5).forEach((item, i) => {
            const y = listY + (isSquare ? 40 : 56) + i * rowStep;
            ctx.fillStyle = accentColor;
            ctx.font = `900 ${fontSize}px Inter, sans-serif`;
            ctx.fillText(`${i + 1}`, col2X, y);

            const titleText = item.track.title || $_("common.unknownTrack");
            const title =
                titleText.length > 16 ? titleText.substring(0, 14) + "…" : titleText;
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 ${fontSize}px Inter, sans-serif`;
            ctx.fillText(title, col2X + 34, y);
        });

        // Footer stat blocks
        const pillH = isSquare ? 104 : 136;
        const pillY = cardY + cardH - (isSquare ? 36 : 56) - pillH;
        const pillW = (innerW - 24) / 2;
        const pill1X = innerX;
        const pill2X = innerX + pillW + 24;

        for (const px of [pill1X, pill2X]) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
            ctx.beginPath();
            ctx.roundRect(px, pillY, pillW, pillH, 20);
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.font = `800 ${isSquare ? 16 : 20}px Inter, sans-serif`;
        ctx.fillText(
            $_("recap.minutesListened").toUpperCase(),
            pill1X + 24,
            pillY + (isSquare ? 34 : 44),
        );
        ctx.fillText(
            $_("recap.topGenre").toUpperCase(),
            pill2X + 24,
            pillY + (isSquare ? 34 : 44),
        );

        const valFont = isSquare ? 38 : 50;
        ctx.fillStyle = "#ffffff";
        ctx.font = `900 ${valFont}px Inter, sans-serif`;
        ctx.fillText(
            formatMinutes($statsSummary?.total_duration_seconds || 0),
            pill1X + 24,
            pillY + (isSquare ? 82 : 106),
        );

        const genreText = topGenres[0] ? topGenres[0][0] : $_("recap.musicFallback");
        const clippedGenre =
            genreText.length > 11 ? genreText.substring(0, 10) + "…" : genreText;
        ctx.fillStyle = accentColor;
        ctx.fillText(clippedGenre, pill2X + 24, pillY + (isSquare ? 82 : 106));
    }

    let previewRenderGen = 0;
    async function renderRecapPreview() {
        if (!recapPreviewCanvas || currentSlide !== 5 || !show) return;
        const gen = ++previewRenderGen;
        const w = 1080;
        const h = recapAspect === "1:1" ? 1080 : 1920;

        // Draw onto an offscreen canvas first so rapid template switches never flicker
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const octx = offscreen.getContext("2d");
        if (!octx) return;
        await drawFinalRecap(octx, w, h);

        if (gen !== previewRenderGen || !recapPreviewCanvas) return;
        recapPreviewCanvas.width = w;
        recapPreviewCanvas.height = h;
        const ctx = recapPreviewCanvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(offscreen, 0, 0);
    }

    $: if (
        show &&
        currentSlide === 5 &&
        recapPreviewCanvas &&
        (recapTheme ||
            recapAspect ||
            recapCovers ||
            $topArtists ||
            $topTracks ||
            $statsSummary ||
            topGenres)
    ) {
        void renderRecapPreview();
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
                    <div class="slide final-slide" in:fade={{ duration: 400 }}>
                        <div class="recap-studio">
                            <div class="recap-preview-frame" class:square={recapAspect === "1:1"}>
                                <canvas
                                    bind:this={recapPreviewCanvas}
                                    class="recap-preview-canvas"
                                    aria-label="Shareable recap preview"
                                ></canvas>
                            </div>

                            <div class="recap-controls" role="toolbar" aria-label="Recap template options">
                                <div class="recap-control-group" role="group" aria-label="Template">
                                    {#each recapThemes as t}
                                        <button
                                            type="button"
                                            class="recap-pill-btn"
                                            class:active={recapTheme === t.id}
                                            on:click={() => (recapTheme = t.id)}
                                        >
                                            {t.label}
                                        </button>
                                    {/each}
                                </div>
                                <div class="recap-control-group" role="group" aria-label="Aspect ratio">
                                    <button
                                        type="button"
                                        class="recap-pill-btn"
                                        class:active={recapAspect === "9:16"}
                                        on:click={() => (recapAspect = "9:16")}
                                    >
                                        9:16
                                    </button>
                                    <button
                                        type="button"
                                        class="recap-pill-btn"
                                        class:active={recapAspect === "1:1"}
                                        on:click={() => (recapAspect = "1:1")}
                                    >
                                        1:1
                                    </button>
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

    .recap-studio {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        min-height: 0;
    }

    .recap-preview-frame {
        flex: 1;
        min-height: 0;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .recap-preview-canvas {
        max-height: 100%;
        max-width: 100%;
        width: auto;
        height: auto;
        border-radius: 18px;
        box-shadow: 0 20px 54px rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .recap-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .recap-control-group {
        display: inline-flex;
        padding: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        gap: 2px;
    }

    .recap-pill-btn {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.72);
        font-size: 0.75rem;
        font-weight: 700;
        padding: 6px 12px;
        min-height: 32px;
        border-radius: 9999px;
        cursor: pointer;
        transition: background-color var(--transition-fast), color var(--transition-fast);
    }

    .recap-pill-btn:hover {
        color: #ffffff;
    }

    .recap-pill-btn.active {
        background: var(--accent-primary);
        color: var(--text-on-accent, #000000);
    }

    .recap-pill-btn:focus-visible {
        outline: 2px solid #ffffff;
        outline-offset: 2px;
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
