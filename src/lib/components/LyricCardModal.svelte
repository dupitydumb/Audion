<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { currentTrack, currentTime } from "$lib/stores/player";
  import { lyricsData, activeLine } from "$lib/stores/lyrics";
  import { albumPalette, meshColors } from "$lib/stores/palette";
  import { resolveTrackCover } from "$lib/stores/library";
  import { proxyFetchBytes, saveImageToGallery } from "$lib/api/tauri";
  import { addToast } from "$lib/stores/toast";
  import { registerBackHandler } from "$lib/stores/mobile";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  export let onClose: () => void = () => { open = false; };
  export let initialLineIndex: number = -1;

  type AspectRatio = "1:1" | "9:16";
  type CardTheme = "frosted" | "vinyl" | "mesh" | "minimal";

  const themes: { id: CardTheme; label: string; long: string }[] = [
    { id: "frosted", label: "Frosted", long: "Frosted Glass" },
    { id: "vinyl", label: "Vinyl", long: "Vinyl" },
    { id: "mesh", label: "Mesh", long: "Mesh Glow" },
    { id: "minimal", label: "Minimal", long: "Minimal" },
  ];

  let aspectRatio: AspectRatio = "1:1";
  let theme: CardTheme = "frosted";
  let selectedIndices: number[] = [];
  let canvas: HTMLCanvasElement;
  let linesListEl: HTMLDivElement | null = null;
  let isCopying = false;
  let isSaving = false;
  let wasOpen = false;

  $: lines = $lyricsData?.lines?.filter(l => l.text && l.text.trim().length > 0) || [];

  $: if (open && !wasOpen) {
    wasOpen = true;
    initSelection();
  } else if (!open && wasOpen) {
    wasOpen = false;
    selectedIndices = [];
  }

  $: if (open && lines.length > 0 && selectedIndices.length === 0) {
    initSelection();
  }

  function initSelection() {
    if (lines.length === 0) return;
    let target = -1;

    // 1. Explicit initialLineIndex passed as prop
    if (initialLineIndex >= 0 && initialLineIndex < lines.length) {
      target = initialLineIndex;
    }
    // 2. Active sung line from lyrics store
    else if ($activeLine >= 0 && $lyricsData?.lines) {
      const activeRaw = $lyricsData.lines[$activeLine];
      if (activeRaw) {
        const found = lines.findIndex(l => l === activeRaw || (l.time === activeRaw.time && l.text === activeRaw.text));
        if (found >= 0) {
          target = found;
        }
      }
    }

    // 3. Fallback based on current audio playback position
    if (target < 0) {
      const now = $currentTime;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].time <= now) {
          target = i;
          break;
        }
      }
    }

    if (target < 0 || target >= lines.length) {
      target = 0;
    }

    // Auto-select the currently active sung lyric line (and up to 2 subsequent lines if space permits)
    const count = Math.min(2, lines.length - target);
    selectedIndices = Array.from({ length: Math.max(1, count) }, (_, i) => target + i);
    renderCard();

    // Auto-scroll the lines selector to center the active sung line
    tick().then(() => {
      if (linesListEl) {
        const activeBtn = linesListEl.querySelector('.line-item.selected') as HTMLElement | null;
        if (activeBtn) {
          activeBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    });
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

  // Tauri serves local files from http(s)://asset.localhost/... (v2) or
  // asset://localhost/... — not tauri.localhost (that is the webview origin).
  function isTauriAssetUrl(src: string): boolean {
    return src.startsWith("asset:") || /\/\/(asset|tauri)\.localhost(?::\d+)?\//i.test(src);
  }

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function loadImage(src: string): Promise<HTMLImageElement> {
    // Normalize covers to data: URLs where possible. Remote hosts go through
    // Rust (no CORS); asset-protocol files are fetched by the webview. A data:
    // URL never taints the canvas, so toBlob/toDataURL keep working when the
    // card is exported on Windows and on mobile.
    let finalSrc = src;
    if (src.startsWith("http") && !isTauriAssetUrl(src)) {
      try {
        const base64 = await proxyFetchBytes(src);
        const ext = src.split("?")[0].split(".").pop()?.toLowerCase();
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        finalSrc = `data:${mime};base64,${base64}`;
      } catch (e) {
        console.warn("[LyricCard] Failed to proxy fetch cover:", e);
      }
    } else if (isTauriAssetUrl(src)) {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        finalSrc = await blobToDataUrl(await res.blob());
      } catch (e) {
        // Fall back to the raw asset URL: preview still renders (raw asset
        // images load without CORS), only export would be blocked if tainted.
        console.warn("[LyricCard] Failed to inline asset cover:", e);
      }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
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

  function hexToRgba(hex: string, alpha: number): string {
    if (!hex) return `rgba(63, 63, 70, ${alpha})`;
    if (hex.startsWith("rgb")) {
      return hex.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
    }
    const clean = hex.replace("#", "");
    if (clean.length === 6) {
      const r = parseInt(clean.substring(0, 2), 16);
      const g = parseInt(clean.substring(2, 4), 16);
      const b = parseInt(clean.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `rgba(63, 63, 70, ${alpha})`;
  }

  function extractColorsFromCover(img: HTMLImageElement): string[] {
    try {
      const off = document.createElement("canvas");
      off.width = 4;
      off.height = 4;
      const octx = off.getContext("2d");
      if (!octx) return [];
      octx.drawImage(img, 0, 0, 4, 4);
      const data = octx.getImageData(0, 0, 4, 4).data;
      const hexes: string[] = [];
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        hexes.push(`rgb(${r}, ${g}, ${b})`);
      }
      return hexes;
    } catch {
      return [];
    }
  }

  function getDynamicPalette(coverImg: HTMLImageElement | null): string[] {
    if ($meshColors && $meshColors.some(c => c && c !== "#0a0a0a")) {
      return $meshColors;
    }
    if ($albumPalette && $albumPalette.length > 0) {
      return $albumPalette.map(p => p.hex);
    }
    if (coverImg) {
      const sampled = extractColorsFromCover(coverImg);
      if (sampled.length > 0) return sampled;
    }
    return ["#27272a", "#3f3f46", "#52525b", "#18181b"];
  }

  let renderToken = 0;

  async function renderCard() {
    const token = ++renderToken;
    await tick();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI canvas smoothing & rendering quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Canvas cannot use a webfont until it is loaded; without this the first
    // render after opening can fall back to a system font.
    try {
      await document.fonts?.ready;
    } catch {
      /* font loading unsupported */
    }

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

    // A newer render started while the cover was loading (theme/ratio/line
    // toggled quickly) — discard this one so the canvas shows the last choice.
    if (token !== renderToken) return;

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
    const palette = getDynamicPalette(coverImg);
    const c1 = hexToRgba(palette[0] || "#7c3aed", 0.55);
    const c2 = hexToRgba(palette[1] || "#10b981", 0.45);
    const c3 = hexToRgba(palette[2] || "#3b82f6", 0.50);
    const c4 = hexToRgba(palette[3] || "#f43f5e", 0.40);
    const c5 = hexToRgba(palette[0] || "#7c3aed", 0.28);

    // Sleek deep base
    ctx.fillStyle = "#0a0b12";
    ctx.fillRect(0, 0, width, height);

    // Ambient cover art blur underlay
    if (coverImg) {
      ctx.save();
      const scale = Math.max(width / coverImg.width, height / coverImg.height) * 1.15;
      const sw = coverImg.width * scale;
      const sh = coverImg.height * scale;
      const sx = (width - sw) / 2;
      const sy = (height - sh) / 2;
      ctx.filter = "blur(80px) brightness(0.28) saturate(1.6)";
      ctx.drawImage(coverImg, sx, sy, sw, sh);
      ctx.restore();
    }

    // Dynamic mesh gradient orbs with responsive layout for 9:16 vertical stories
    const isStory = height > width;
    const orbs = isStory
      ? [
          { x: width * 0.15, y: height * 0.16, r: width * 0.65, c: c1 },
          { x: width * 0.85, y: height * 0.32, r: width * 0.60, c: c2 },
          { x: width * 0.20, y: height * 0.60, r: width * 0.70, c: c3 },
          { x: width * 0.82, y: height * 0.82, r: width * 0.65, c: c4 },
          { x: width * 0.50, y: height * 0.46, r: width * 0.50, c: c5 },
        ]
      : [
          { x: width * 0.20, y: height * 0.25, r: width * 0.55, c: c1 },
          { x: width * 0.80, y: height * 0.35, r: width * 0.50, c: c2 },
          { x: width * 0.30, y: height * 0.75, r: width * 0.60, c: c3 },
          { x: width * 0.85, y: height * 0.80, r: width * 0.45, c: c4 },
        ];

    for (const orb of orbs) {
      const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      g.addColorStop(0, orb.c);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }

    // Soft ambient vignette to guarantee lyric readability across themes
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, width * 0.2,
      width / 2, height / 2, Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, "rgba(5, 6, 10, 0.1)");
    vignette.addColorStop(1, "rgba(5, 6, 10, 0.75)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
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
    if (theme === "mesh") {
      ctx.fillStyle = "rgba(14, 16, 24, 0.78)";
    } else {
      ctx.fillStyle = "rgba(20, 22, 30, 0.72)";
    }
    ctx.fill();

    // Dynamic or frosted gradient outline
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    if (theme === "mesh") {
      const palette = getDynamicPalette(coverImg);
      borderGrad.addColorStop(0, hexToRgba(palette[0] || "#7c3aed", 0.55));
      borderGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
      borderGrad.addColorStop(1, hexToRgba(palette[1] || "#3b82f6", 0.45));
      ctx.strokeStyle = borderGrad;
      ctx.lineWidth = 2.5;
    } else {
      borderGrad.addColorStop(0, "rgba(255, 255, 255, 0.25)");
      borderGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.06)");
      borderGrad.addColorStop(1, "rgba(255, 255, 255, 0.18)");
      ctx.strokeStyle = borderGrad;
      ctx.lineWidth = 2;
    }
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
      // Image clipboard writes are unsupported on some WebViews (Android),
      // so save to the gallery instead of failing outright.
      await saveImage();
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

      try {
        await saveImageToGallery(base64Data, fileName);
        addToast("Lyric card saved to gallery!", "success");
      } catch (err) {
        console.warn("[LyricCard] Gallery save failed, falling back to download:", err);
        const link = document.createElement("a");
        link.download = fileName;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
        addToast("Lyric card downloaded!", "success");
      }
    } catch (err) {
      console.error("[LyricCard] Image export failed:", err);
      addToast("Failed to export lyric card", "error");
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

  let unregisterBackHandler: (() => void) | null = null;

  $: if (open) {
    if (!unregisterBackHandler) {
      unregisterBackHandler = registerBackHandler(() => {
        onClose();
        return true;
      });
    }
  } else if (unregisterBackHandler) {
    unregisterBackHandler();
    unregisterBackHandler = null;
  }

  onDestroy(() => {
    if (unregisterBackHandler) {
      unregisterBackHandler();
      unregisterBackHandler = null;
    }
  });

  function handleWindowKeydown(e: KeyboardEvent) {
    if (open && e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
  <div
    class="lyric-card-overlay"
    transition:fade={{ duration: 160 }}
    role="presentation"
    on:click|self={onClose}
  >
    <div
      class="lyric-card-modal"
      transition:scale={{ duration: 180, start: 0.96 }}
      role="dialog"
      aria-modal="true"
      aria-label="Shareable Lyric Card"
    >
      <header class="modal-header">
        <div class="header-left">
          <Icon name="image" size={18} />
          <div class="header-text">
            <span class="modal-title">Lyric Card</span>
            <span class="modal-subtitle">Pick lines and a theme, then share</span>
          </div>
        </div>
        <button class="btn-close" on:click={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>
      </header>

      <div class="modal-body">
        <section class="preview-panel">
          <div class="canvas-frame" class:story={aspectRatio === "9:16"}>
            <canvas bind:this={canvas}></canvas>
          </div>
          <span class="preview-caption">
            {selectedIndices.length} line{selectedIndices.length === 1 ? "" : "s"} · {aspectRatio === "1:1" ? "square" : "story"}
          </span>
        </section>

        <section class="controls-panel">
          <div class="control-section lines-section">
            <div class="lines-header">
              <span class="control-label">Choose lines</span>
              <span class="lines-count">{selectedIndices.length}/5</span>
            </div>
            <div class="lines-list" bind:this={linesListEl}>
              {#if lines.length === 0}
                <div class="lines-empty">No synced or plain lyric lines available for this track.</div>
              {:else}
                {#each lines as line, idx}
                  <button
                    type="button"
                    class="line-item"
                    class:selected={selectedIndices.includes(idx)}
                    on:click={() => toggleLine(idx)}
                  >
                    <span class="line-check">
                      {#if selectedIndices.includes(idx)}
                        <Icon name="check" size={12} />
                      {/if}
                    </span>
                    <span class="line-text">{line.text}</span>
                  </button>
                {/each}
              {/if}
            </div>
          </div>

          <div class="options-row">
            <div class="control-section">
              <span class="control-label">Format</span>
              <div class="segmented">
                <button
                  class="segment"
                  class:active={aspectRatio === "1:1"}
                  on:click={() => setAspectRatio("1:1")}
                >
                  <span>Square</span><small>1:1</small>
                </button>
                <button
                  class="segment"
                  class:active={aspectRatio === "9:16"}
                  on:click={() => setAspectRatio("9:16")}
                >
                  <span>Story</span><small>9:16</small>
                </button>
              </div>
            </div>

            <div class="control-section">
              <span class="control-label">Theme</span>
              <div class="theme-chips">
                {#each themes as t (t.id)}
                  <button
                    class="theme-chip"
                    class:active={theme === t.id}
                    on:click={() => setTheme(t.id)}
                    title={t.long}
                  >
                    {t.label}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer class="action-bar">
        <button class="btn-action secondary" on:click={saveImage} disabled={isSaving}>
          <Icon name="download" size={16} />
          <span>{isSaving ? "Saving…" : "Save"}</span>
        </button>
        <button class="btn-action icon-only" on:click={nativeShare} title="Share" aria-label="Share">
          <Icon name="share" size={16} />
        </button>
        <button class="btn-action primary" on:click={copyToClipboard} disabled={isCopying}>
          <Icon name="copy" size={16} />
          <span>{isCopying ? "Copying…" : "Copy image"}</span>
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .lyric-card-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 4000);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(16px + var(--safe-area-top, 0px)) 16px calc(16px + var(--safe-area-bottom, 0px));
    background: rgba(6, 7, 10, 0.78);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    overscroll-behavior: contain;
  }

  .lyric-card-modal {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 860px;
    max-height: min(90dvh, 760px);
    /* the composer is a fixed dark surface in both app themes so the preview
       stays the visual anchor; do not follow --bg-elevated here */
    background: rgba(22, 23, 30, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.65);
    overflow: hidden;
  }

  /* ── Header ─────────────────────────────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 15px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    flex: 0 0 auto;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    color: var(--accent-primary, #1db954);
  }

  .header-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .modal-title {
    font-size: 0.95rem;
    font-weight: 650;
    color: #fff;
    line-height: 1.2;
  }

  .modal-subtitle {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.68);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-close {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin-right: -6px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .btn-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  /* ── Body ───────────────────────────────────────────────── */
  .modal-body {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 24px;
    padding: 20px;
    overflow-y: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }

  .preview-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
  }

  .canvas-frame {
    display: flex;
    width: 100%;
    max-width: 340px;
    aspect-ratio: 1 / 1;
    border-radius: 14px;
    overflow: hidden;
    background: #0b0c10;
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5);
  }

  .canvas-frame.story {
    aspect-ratio: 9 / 16;
    max-width: 230px;
  }

  .canvas-frame canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .preview-caption {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.68);
    letter-spacing: 0.02em;
  }

  .controls-panel {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }

  .control-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .control-label {
    font-size: 0.7rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.68);
  }

  /* ── Format segmented control ───────────────────────────── */
  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .segment {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 38px;
    padding: 0 10px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .segment small {
    font-size: 0.65rem;
    font-weight: 500;
    line-height: 1;
    opacity: 0.6;
  }

  .segment.active {
    background: #0d0e13;
    color: #fff;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  }

  /* ── Format + theme rows ────────────────────────────────── */
  .options-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }

  .theme-chips {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .theme-chip {
    min-width: 0;
    min-height: 38px;
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 9px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.72);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
  }

  .theme-chip:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .theme-chip.active {
    border-color: var(--accent-primary, #1db954);
    background: color-mix(in srgb, var(--accent-primary, #1db954) 14%, transparent);
    color: var(--accent-primary, #1db954);
  }

  /* ── Line selector: the primary control ─────────────────── */
  .lines-section {
    flex: 1 1 auto;
    min-height: 0;
  }

  .lines-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .lines-count {
    font-size: 0.72rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.68);
  }

  .lines-empty {
    padding: 20px 12px;
    text-align: center;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.68);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 9px;
  }

  .lines-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: min(42vh, 340px);
    overflow-y: auto;
    padding-right: 2px;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  .line-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 40px;
    padding: 9px 12px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.8);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }

  .line-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .line-item.selected {
    background: color-mix(in srgb, var(--accent-primary, #1db954) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary, #1db954) 40%, transparent);
    color: #fff;
  }

  .line-check {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    color: #000;
  }

  .line-item.selected .line-check {
    background: var(--accent-primary, #1db954);
    border-color: var(--accent-primary, #1db954);
  }

  .line-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
  }

  /* ── Actions ────────────────────────────────────────────── */
  .action-bar {
    display: flex;
    gap: 8px;
    padding: 14px 18px calc(14px + var(--safe-area-bottom, 0px));
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    flex: 0 0 auto;
  }

  .btn-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 16px;
    border: none;
    border-radius: 10px;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 650;
    cursor: pointer;
    transition: filter 0.15s ease, background 0.15s ease;
  }

  .btn-action.primary {
    flex: 1;
    background: var(--accent-primary, #1db954);
    color: var(--text-on-accent, #000000);
  }

  .btn-action.primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .btn-action.secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .btn-action.secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.13);
  }

  .btn-action.icon-only {
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }

  .btn-action.icon-only:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .lyric-card-modal button:focus-visible {
    outline: 2px solid var(--accent-primary, #1db954);
    outline-offset: 2px;
  }

  /* ── Phone: bottom sheet ────────────────────────────────── */
  :global(html.layout-mobile) .lyric-card-overlay {
    align-items: flex-end;
    padding: var(--safe-area-top, 16px) 0 0;
  }

  :global(html.layout-mobile) .lyric-card-modal {
    max-width: 100%;
    max-height: 90dvh;
    border-radius: 20px 20px 0 0;
    border-bottom: none;
    animation: springSlideUp 0.32s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
  }

  :global(html.layout-mobile) .modal-header {
    position: relative;
    padding: 16px 16px 12px;
  }

  :global(html.layout-mobile) .modal-header::before {
    content: "";
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.22);
  }

  :global(html.layout-mobile) .btn-close {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  :global(html.layout-mobile) .modal-body {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    padding: 14px 16px;
  }

  :global(html.layout-mobile) .canvas-frame {
    max-width: min(44vw, 190px);
  }

  :global(html.layout-mobile) .canvas-frame.story {
    max-width: min(32vw, 140px);
  }

  :global(html.layout-mobile) .segment,
  :global(html.layout-mobile) .theme-chip,
  :global(html.layout-mobile) .line-item {
    min-height: 44px;
  }

  :global(html.layout-mobile) .btn-action.icon-only {
    min-width: 46px;
    padding: 0 14px;
  }

  :global(html.layout-mobile) .lines-list {
    max-height: 34vh;
  }

  :global(html.layout-mobile) .action-bar {
    padding: 12px 16px calc(12px + var(--safe-area-bottom, 0px));
  }

  :global(html.layout-mobile) .btn-action {
    min-height: 46px;
    font-size: 0.85rem;
  }

  :global(html.layout-mobile) .btn-action.secondary {
    flex: 0 0 auto;
  }

  @media (max-width: 380px) {
    .theme-chips {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
