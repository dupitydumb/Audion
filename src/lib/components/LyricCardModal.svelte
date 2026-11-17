<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { currentTrack } from "$lib/stores/player";
  import { lyricsData, activeLine } from "$lib/stores/lyrics";
  import { resolveTrackCover } from "$lib/stores/library";
  import { proxyFetchBytes, saveImageToGallery } from "$lib/api/tauri";
  import { addToast } from "$lib/stores/toast";
  import Icon from "$lib/components/Icon.svelte";
  import { _ } from "svelte-i18n";

  export let open: boolean = false;
  export let onClose: () => void = () => { open = false; };
  export let initialLineIndex: number = -1;

  type AspectRatio = "1:1" | "9:16";
  type CardTheme = "frosted" | "vinyl" | "mesh" | "minimal";

  let aspectRatio: AspectRatio = "1:1";
  let theme: CardTheme = "frosted";
  let selectedIndices: number[] = [];
  let canvas: HTMLCanvasElement;
  let isGenerating = false;
  let isCopying = false;
  let isSaving = false;

  $: lines = $lyricsData?.lines?.filter(l => l.text && l.text.trim().length > 0) || [];

  $: if (open && lines.length > 0 && selectedIndices.length === 0) {
    initSelection();
  }

  function initSelection() {
    if (lines.length === 0) return;
    let target = 0;
    if (initialLineIndex >= 0 && initialLineIndex < lines.length) {
      target = initialLineIndex;
    } else if ($activeLine >= 0 && $activeLine < lines.length) {
      target = $activeLine;
    }
    // Select up to 3 lines starting from target
    const count = Math.min(3, lines.length - target);
    selectedIndices = Array.from({ length: Math.max(1, count) }, (_, i) => target + i);
    renderCard();
  }

  function toggleLine(index: number) {
    if (selectedIndices.includes(index)) {
      if (selectedIndices.length <= 1) {
        addToast("Select at least 1 lyric line", "warning");
        return;
      }
      selectedIndices = selectedIndices.filter(i => i !== index);
    } else {
      if (selectedIndices.length >= 5) {
        addToast("Maximum 5 lines per lyric card", "info");
        return;
      }
      selectedIndices = [...selectedIndices, index].sort((a, b) => a - b);
    }
    renderCard();
  }

  function setAspectRatio(ratio: AspectRatio) {
    if (aspectRatio === ratio) return;
    aspectRatio = ratio;
    renderCard();
  }

  function setTheme(t: CardTheme) {
    if (theme === t) return;
    theme = t;
    renderCard();
  }

  async function loadImage(src: string): Promise<HTMLImageElement> {
    let finalSrc = src;
    if (src.startsWith("http") && !src.includes("tauri.localhost")) {
      try {
        const base64 = await proxyFetchBytes(src);
        const ext = src.split(".").pop()?.toLowerCase();
        const mime = ext === "png" ? "image/png" : "image/jpeg";
        finalSrc = `data:${mime};base64,${base64}`;
      } catch (e) {
        console.warn("[LyricCard] Failed to proxy fetch cover:", e);
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

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ): number {
    const words = text.split(" ");
    let line = "";
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line.trim(), x, currentY);
        line = words[n] + " ";
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), x, currentY);
    return currentY + lineHeight;
  }

  async function renderCard() {
    await tick();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 1080;
    const height = aspectRatio === "1:1" ? 1080 : 1920;
    canvas.width = width;
    canvas.height = height;

    const track = $currentTrack;
    const title = track?.title || "Unknown Title";
    const artist = track?.artist || "Unknown Artist";
    const album = track?.album || "";
    const coverSrc = track ? resolveTrackCover(track) : null;

    let coverImg: HTMLImageElement | null = null;
    if (coverSrc) {
      try {
        coverImg = await loadImage(coverSrc);
      } catch (e) {
        coverImg = null;
      }
    }

    // ── 1. Draw Background ──
    if (theme === "frosted") {
      drawFrostedBackground(ctx, width, height, coverImg);
    } else if (theme === "vinyl") {
      drawVinylBackground(ctx, width, height, coverImg);
    } else if (theme === "mesh") {
      drawMeshBackground(ctx, width, height, coverImg);
    } else {
      drawMinimalBackground(ctx, width, height);
    }

    // ── 2. Card Interior / Layout ──
    if (theme === "vinyl") {
      drawVinylCardContent(ctx, width, height, title, artist, album, coverImg);
    } else {
      drawStandardCardContent(ctx, width, height, title, artist, album, coverImg);
    }
  }

  function drawFrostedBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    coverImg: HTMLImageElement | null
  ) {
    if (coverImg) {
      ctx.save();
      // Draw zoomed cover image to fill
      const scale = Math.max(width / coverImg.width, height / coverImg.height) * 1.2;
      const sw = coverImg.width * scale;
      const sh = coverImg.height * scale;
      const sx = (width - sw) / 2;
      const sy = (height - sh) / 2;
      ctx.filter = "blur(70px) brightness(0.4) saturate(1.4)";
      ctx.drawImage(coverImg, sx, sy, sw, sh);
      ctx.restore();
    } else {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, "#1f1c2c");
      grad.addColorStop(1, "#928dab");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Dark glass gradient vignette
    const darkGrad = ctx.createRadialGradient(
      width / 2, height / 2, width * 0.1,
      width / 2, height / 2, width * 0.9
    );
    darkGrad.addColorStop(0, "rgba(10, 10, 15, 0.4)");
    darkGrad.addColorStop(1, "rgba(5, 5, 8, 0.85)");
    ctx.fillStyle = darkGrad;
    ctx.fillRect(0, 0, width, height);
  }

  function drawVinylBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    coverImg: HTMLImageElement | null
  ) {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#121318");
    bgGrad.addColorStop(0.5, "#0b0c10");
    bgGrad.addColorStop(1, "#18161f");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Warm radial lighting from top
    const lightGrad = ctx.createRadialGradient(width * 0.5, 0, 50, width * 0.5, 0, width * 0.8);
    lightGrad.addColorStop(0, "rgba(255, 230, 200, 0.12)");
    lightGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = lightGrad;
    ctx.fillRect(0, 0, width, height);
  }

  function drawMeshBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    coverImg: HTMLImageElement | null
  ) {
    // Base dark indigo
    ctx.fillStyle = "#0c0d14";
    ctx.fillRect(0, 0, width, height);

    // Mesh gradient orbs
    const orbs = [
      { x: width * 0.2, y: height * 0.25, r: width * 0.5, c: "rgba(124, 58, 237, 0.45)" }, // Violet
      { x: width * 0.8, y: height * 0.4, r: width * 0.45, c: "rgba(16, 185, 129, 0.35)" }, // Emerald
      { x: width * 0.3, y: height * 0.75, r: width * 0.55, c: "rgba(59, 130, 246, 0.4)" },  // Blue
      { x: width * 0.85, y: height * 0.85, r: width * 0.4, c: "rgba(244, 63, 94, 0.3)" },   // Rose
    ];

    for (const orb of orbs) {
      const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      g.addColorStop(0, orb.c);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
  }

  function drawMinimalBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "#111216");
    grad.addColorStop(1, "#08090b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Fine border frame
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, width - 80, height - 80);
  }

  function drawStandardCardContent(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    title: string,
    artist: string,
    album: string,
    coverImg: HTMLImageElement | null
  ) {
    const isSquare = height === 1080;
    const cardPadding = 80;
    const cardX = 90;
    const cardY = isSquare ? 110 : 260;
    const cardW = width - 180;
    const cardH = isSquare ? 860 : 1400;

    // Glass Container Card
    ctx.save();
    roundRect(ctx, cardX, cardY, cardW, cardH, 36);
    ctx.fillStyle = "rgba(20, 22, 30, 0.72)";
    ctx.fill();

    // Subtle gradient outline
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, "rgba(255, 255, 255, 0.25)");
    borderGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.06)");
    borderGrad.addColorStop(1, "rgba(255, 255, 255, 0.18)");
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Track Meta Row (Header inside card)
    const headerY = cardY + 70;
    const thumbSize = isSquare ? 100 : 120;
    const thumbX = cardX + 60;
    const textStartX = thumbX + thumbSize + 30;

    if (coverImg) {
      ctx.save();
      roundRect(ctx, thumbX, headerY, thumbSize, thumbSize, 18);
      ctx.clip();
      ctx.drawImage(coverImg, thumbX, headerY, thumbSize, thumbSize);
      ctx.restore();

      // Border on thumbnail
      ctx.save();
      roundRect(ctx, thumbX, headerY, thumbSize, thumbSize, 18);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      roundRect(ctx, thumbX, headerY, thumbSize, thumbSize, 18);
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.fill();
      ctx.restore();
    }

    // Title and Artist
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 38px Inter, -apple-system, sans-serif";
    ctx.fillText(title, textStartX, headerY + 45, cardW - (thumbSize + 110));

    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.font = "500 28px Inter, -apple-system, sans-serif";
    const subText = album ? `${artist} • ${album}` : artist;
    ctx.fillText(subText, textStartX, headerY + 90, cardW - (thumbSize + 110));

    // Divider Line
    const divY = headerY + thumbSize + 40;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cardX + 60, divY);
    ctx.lineTo(cardX + cardW - 60, divY);
    ctx.stroke();

    // ── Lyrics Block ──
    const selectedLyrics = selectedIndices
      .map(i => lines[i]?.text)
      .filter(Boolean);

    let lyricsStartY = divY + (isSquare ? 90 : 150);
    const maxLyricsWidth = cardW - 120;

    // Dynamic Font Sizing based on line count and length
    const totalLines = selectedLyrics.length;
    let fontSize = isSquare
      ? (totalLines <= 2 ? 46 : totalLines <= 3 ? 38 : 32)
      : (totalLines <= 2 ? 52 : totalLines <= 3 ? 44 : 36);
    let lineHeight = fontSize * 1.55;

    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;

    // Quotation Mark decoration
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.font = "bold 90px Georgia, serif";
    ctx.fillText("“", cardX + 50, lyricsStartY - 10);
    ctx.restore();

    for (const line of selectedLyrics) {
      lyricsStartY = wrapText(ctx, line, cardX + 65, lyricsStartY, maxLyricsWidth, lineHeight);
      lyricsStartY += fontSize * 0.4;
    }

    // ── Audion Watermark Badge (Bottom) ──
    const badgeY = cardY + cardH - 50;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "600 22px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LISTEN ON AUDION", width / 2, badgeY);
  }

  function drawVinylCardContent(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    title: string,
    artist: string,
    album: string,
    coverImg: HTMLImageElement | null
  ) {
    const isSquare = height === 1080;
    const topAreaY = isSquare ? 120 : 280;

    // ── Vinyl + Sleeve Assembly ──
    const jacketSize = isSquare ? 320 : 380;
    const jacketX = 140;
    const jacketY = topAreaY;

    // Draw Vinyl Record Sliding Out to Right
    const vinylCenterX = jacketX + jacketSize * 0.85;
    const vinylCenterY = jacketY + jacketSize / 2;
    const vinylRadius = jacketSize * 0.48;

    // Outer Vinyl Edge
    ctx.save();
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, vinylRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#111113";
    ctx.fill();

    // Grooves (Concentric Arcs)
    for (let r = vinylRadius * 0.55; r < vinylRadius * 0.95; r += 7) {
      ctx.beginPath();
      ctx.arc(vinylCenterX, vinylCenterY, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Dynamic Reflection Glare
    const glareGrad = ctx.createLinearGradient(
      vinylCenterX - vinylRadius, vinylCenterY - vinylRadius,
      vinylCenterX + vinylRadius, vinylCenterY + vinylRadius
    );
    glareGrad.addColorStop(0, "rgba(255, 255, 255, 0.12)");
    glareGrad.addColorStop(0.5, "rgba(255, 255, 255, 0)");
    glareGrad.addColorStop(1, "rgba(255, 255, 255, 0.12)");
    ctx.fillStyle = glareGrad;
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, vinylRadius, 0, Math.PI * 2);
    ctx.fill();

    // Center Label Circle (mini album art or red vinyl sticker)
    const labelRadius = vinylRadius * 0.36;
    ctx.save();
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, labelRadius, 0, Math.PI * 2);
    ctx.clip();
    if (coverImg) {
      ctx.drawImage(
        coverImg,
        vinylCenterX - labelRadius, vinylCenterY - labelRadius,
        labelRadius * 2, labelRadius * 2
      );
    } else {
      ctx.fillStyle = "#d9383a";
      ctx.fill();
    }
    ctx.restore();

    // Center Hole
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
    ctx.restore();

    // Album Jacket (Sleeve) on Top
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetX = -10;
    ctx.shadowOffsetY = 15;
    roundRect(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
    ctx.fillStyle = "#1b1c22";
    ctx.fill();

    if (coverImg) {
      roundRect(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
      ctx.clip();
      ctx.drawImage(coverImg, jacketX, jacketY, jacketSize, jacketSize);
    }
    ctx.restore();

    // Subtle spine glare on jacket
    ctx.save();
    roundRect(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Track Meta right below vinyl assembly
    const metaY = jacketY + jacketSize + 55;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 38px Inter, sans-serif";
    ctx.fillText(title, width / 2, metaY);

    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.font = "500 26px Inter, sans-serif";
    ctx.fillText(album ? `${artist} • ${album}` : artist, width / 2, metaY + 45);

    // ── Lyrics Section ──
    const selectedLyrics = selectedIndices
      .map(i => lines[i]?.text)
      .filter(Boolean);

    let lyricsStartY = metaY + 110;
    const maxLyricsWidth = width - 240;
    const totalLines = selectedLyrics.length;
    let fontSize = isSquare
      ? (totalLines <= 2 ? 40 : totalLines <= 3 ? 34 : 28)
      : (totalLines <= 2 ? 46 : totalLines <= 3 ? 40 : 32);
    let lineHeight = fontSize * 1.55;

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${fontSize}px Inter, sans-serif`;

    for (const line of selectedLyrics) {
      lyricsStartY = wrapText(ctx, line, width / 2, lyricsStartY, maxLyricsWidth, lineHeight);
      lyricsStartY += fontSize * 0.4;
    }

    // Watermark
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "600 22px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("AUDION MUSIC", width / 2, height - (isSquare ? 45 : 80));
  }

  async function getCanvasBlob(): Promise<Blob | null> {
    if (!canvas) return null;
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  async function copyToClipboard() {
    if (isCopying) return;
    isCopying = true;
    try {
      const blob = await getCanvasBlob();
      if (!blob) throw new Error("Canvas render failed");

      if (navigator.clipboard && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ "image/png": blob })
        ]);
        addToast("Lyric card copied to clipboard!", "success");
      } else {
        // Fallback: download
        await saveImage();
      }
    } catch (err) {
      console.error("[LyricCard] Clipboard copy failed:", err);
      addToast("Failed to copy card to clipboard", "error");
    } finally {
      isCopying = false;
    }
  }

  async function saveImage() {
    if (isSaving || !canvas) return;
    isSaving = true;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const base64Data = dataUrl.split(",")[1];
      const track = $currentTrack;
      const cleanTitle = (track?.title || "Lyrics").replace(/[\\/:*?"<>|]/g, "_");
      const cleanArtist = (track?.artist || "Audion").replace(/[\\/:*?"<>|]/g, "_");
      const fileName = `${cleanArtist} - ${cleanTitle} (Lyrics).png`;

      await saveImageToGallery(base64Data, fileName);
      addToast("Lyric card saved to gallery!", "success");
    } catch (err) {
      console.error("[LyricCard] Image save failed:", err);
      // Browser fallback
      const link = document.createElement("a");
      link.download = "Audion_Lyrics.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      addToast("Lyric card downloaded!", "success");
    } finally {
      isSaving = false;
    }
  }

  async function nativeShare() {
    try {
      const blob = await getCanvasBlob();
      if (!blob) return;
      const file = new File([blob], "Audion_Lyrics.png", { type: "image/png" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${$currentTrack?.title} Lyrics`,
          text: `Check out these lyrics on Audion`,
        });
      } else {
        await copyToClipboard();
      }
    } catch (err) {
      console.warn("[LyricCard] Native share aborted or failed:", err);
    }
  }

  $: if (open) {
    tick().then(() => renderCard());
  }
</script>

{#if open}
  <div class="lyric-card-overlay" transition:fade={{ duration: 160 }}>
    <div class="lyric-card-modal" transition:scale={{ duration: 180, start: 0.95 }}>
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="header-left">
          <Icon name="image" size={18} />
          <span class="modal-title">Shareable Lyric Card</span>
        </div>
        <button class="btn-close" on:click={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-content">
        <!-- Live Preview Area -->
        <div class="preview-panel">
          <div class="canvas-container ratio-{aspectRatio === '1:1' ? 'square' : 'story'}">
            <canvas bind:this={canvas}></canvas>
          </div>
        </div>

        <!-- Options & Line Selector Panel -->
        <div class="controls-panel">
          <!-- Aspect Ratio Toggle -->
          <div class="control-section">
            <span class="control-label">Aspect Ratio</span>
            <div class="button-toggle-group">
              <button
                class="toggle-btn"
                class:active={aspectRatio === "1:1"}
                on:click={() => setAspectRatio("1:1")}
              >
                1:1 Square (Feed)
              </button>
              <button
                class="toggle-btn"
                class:active={aspectRatio === "9:16"}
                on:click={() => setAspectRatio("9:16")}
              >
                9:16 Story (Status)
              </button>
            </div>
          </div>

          <!-- Theme Selector -->
          <div class="control-section">
            <span class="control-label">Card Theme</span>
            <div class="theme-grid">
              <button
                class="theme-card-btn theme-frosted"
                class:active={theme === "frosted"}
                on:click={() => setTheme("frosted")}
              >
                <span class="theme-name">Frosted Glass</span>
              </button>
              <button
                class="theme-card-btn theme-vinyl"
                class:active={theme === "vinyl"}
                on:click={() => setTheme("vinyl")}
              >
                <span class="theme-name">Vinyl Card</span>
              </button>
              <button
                class="theme-card-btn theme-mesh"
                class:active={theme === "mesh"}
                on:click={() => setTheme("mesh")}
              >
                <span class="theme-name">Mesh Glow</span>
              </button>
              <button
                class="theme-card-btn theme-minimal"
                class:active={theme === "minimal"}
                on:click={() => setTheme("minimal")}
              >
                <span class="theme-name">Minimal</span>
              </button>
            </div>
          </div>

          <!-- Lyric Lines Selector -->
          <div class="control-section lines-section">
            <div class="lines-section-header">
              <span class="control-label">Select Lines ({selectedIndices.length}/5)</span>
              <small class="lines-hint">Pick up to 5 lines to display</small>
            </div>
            <div class="lines-list">
              {#each lines as line, idx}
                <button
                  type="button"
                  class="line-item"
                  class:selected={selectedIndices.includes(idx)}
                  on:click={() => toggleLine(idx)}
                >
                  <div class="line-checkbox">
                    {#if selectedIndices.includes(idx)}
                      <Icon name="check" size={12} />
                    {/if}
                  </div>
                  <span class="line-text">{line.text}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-row">
            <button class="btn-action primary" on:click={copyToClipboard} disabled={isCopying}>
              <Icon name="copy" size={16} />
              <span>{isCopying ? "Copying..." : "Copy Image"}</span>
            </button>
            <button class="btn-action secondary" on:click={saveImage} disabled={isSaving}>
              <Icon name="download" size={16} />
              <span>{isSaving ? "Saving..." : "Save PNG"}</span>
            </button>
            <button class="btn-action icon-only" on:click={nativeShare} title="Share">
              <Icon name="share-2" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .lyric-card-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .lyric-card-modal {
    background: rgba(22, 23, 30, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 18px;
    width: 100%;
    max-width: 900px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--accent-primary, #1db954);
  }

  .modal-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
  }

  .btn-close {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .modal-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    padding: 20px;
    overflow-y: auto;
    max-height: calc(90vh - 60px);
  }

  @media (max-width: 768px) {
    .modal-content {
      grid-template-columns: 1fr;
    }
  }

  .preview-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 14px;
    padding: 16px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .canvas-container {
    width: 100%;
    max-width: 360px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .canvas-container canvas {
    width: 100%;
    height: auto;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }

  .controls-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .control-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .control-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .button-toggle-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    background: rgba(0, 0, 0, 0.3);
    padding: 3px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .toggle-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toggle-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-weight: 600;
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .theme-card-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 10px;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .theme-card-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .theme-card-btn.active {
    border-color: var(--accent-primary, #1db954);
    background: rgba(29, 185, 84, 0.12);
    color: var(--accent-primary, #1db954);
    font-weight: 600;
  }

  .lines-section {
    flex: 1;
    min-height: 140px;
  }

  .lines-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .lines-hint {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .lines-list {
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 4px;
  }

  .line-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .line-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .line-item.selected {
    background: rgba(29, 185, 84, 0.12);
    border-color: rgba(29, 185, 84, 0.35);
  }

  .line-checkbox {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--accent-primary, #1db954);
  }

  .line-item.selected .line-checkbox {
    background: var(--accent-primary, #1db954);
    border-color: var(--accent-primary, #1db954);
    color: #000;
  }

  .line-text {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.85);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line-item.selected .line-text {
    color: #fff;
    font-weight: 500;
  }

  .action-row {
    display: flex;
    gap: 8px;
    margin-top: auto;
    padding-top: 10px;
  }

  .btn-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 14px;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }

  .btn-action.primary {
    flex: 1;
    background: var(--accent-primary, #1db954);
    color: #000;
  }

  .btn-action.primary:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .btn-action.secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .btn-action.secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }

  .btn-action.icon-only {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    padding: 9px 12px;
  }

  .btn-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
