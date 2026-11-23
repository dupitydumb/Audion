<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { theme } from '$lib/stores/theme';
  import { isPlaying, volume, getHtml5Analyser } from '$lib/stores/player';
  import { isBackgroundFrozen } from '$lib/stores/offstage';

  /** Width of the canvas in CSS px — parent should constrain this */
  export let width = 120;
  export let height = 32;

  let canvas: HTMLCanvasElement;
  let rafId: number | null = null;
  let ctx2d: CanvasRenderingContext2D | null = null;

  // Cached accent color from CSS var
  let accentColor = '#1DB954';
  let freqBuf: Uint8Array | null = null;
  let timeBuf: Uint8Array | null = null;

  function normalizeColor(color: string): string {
    if (!color) return '#1DB954';
    const c = color.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    }
    if (/^#[0-9a-fA-F]{8}$/.test(c)) {
      return c.slice(0, 7);
    }
    const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      const r = Math.min(255, parseInt(rgbMatch[1], 10)).toString(16).padStart(2, '0');
      const g = Math.min(255, parseInt(rgbMatch[2], 10)).toString(16).padStart(2, '0');
      const b = Math.min(255, parseInt(rgbMatch[3], 10)).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    if (typeof document !== 'undefined') {
      try {
        const helper = document.createElement('canvas').getContext('2d');
        if (helper) {
          helper.fillStyle = c;
          const normalized = helper.fillStyle;
          if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized;
          const m = normalized.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
          if (m) {
            const r = Math.min(255, parseInt(m[1], 10)).toString(16).padStart(2, '0');
            const g = Math.min(255, parseInt(m[2], 10)).toString(16).padStart(2, '0');
            const b = Math.min(255, parseInt(m[3], 10)).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
          }
        }
      } catch {}
    }
    return '#1DB954';
  }

  function getAccent(): string {
    if (typeof document === 'undefined') return accentColor;
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary').trim() || accentColor;
    return normalizeColor(raw);
  }

  $: if ($theme) {
    accentColor = getAccent();
  }

  // ── Draw modes (Hardware Analyser) ─────────────────────────────────────────

  function drawBars(analyser: AnalyserNode, ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
    if ($volume === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqBuf);

    ctx.clearRect(0, 0, w, h);

    const barCount = 24;
    const step = Math.floor(freqBuf.length / barCount);
    const barW = (w / barCount) * 0.7;
    const gap = (w / barCount) * 0.3;

    for (let i = 0; i < barCount; i++) {
      const val = freqBuf[i * step] / 255;
      const barH = Math.max(2, val * h);
      const x = i * (barW + gap);
      const y = h - barH;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.4 + val * 0.6;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barW, barH, 2);
      } else {
        ctx.rect(x, y, barW, barH);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawWave(analyser: AnalyserNode, ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
    if ($volume === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    if (!timeBuf || timeBuf.length !== analyser.fftSize) {
      timeBuf = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(timeBuf);

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();

    const sliceW = w / timeBuf.length;
    let x = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = timeBuf[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBlurPulse(analyser: AnalyserNode, ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
    if ($volume === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqBuf);

    // Average energy of bass/mid range
    const sliceEnd = Math.floor(freqBuf.length / 4);
    let sum = 0;
    for (let i = 0; i < sliceEnd; i++) sum += freqBuf[i];
    const energy = sum / sliceEnd / 255; // 0–1

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const r = (Math.min(w, h) / 2 - 2) * (0.4 + energy * 0.6);

    const safeColor = normalizeColor(color);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
    grad.addColorStop(0, safeColor + 'cc');
    grad.addColorStop(1, safeColor + '00');

    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ── Synthesized Fallback (Desktop Native Rodio Engine) ──────────────────────

  function drawSynthesizedBars(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, t: number, vol: number) {
    if (vol === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);

    const barCount = 24;
    const barW = (w / barCount) * 0.7;
    const gap = (w / barCount) * 0.3;
    const volScale = Math.max(0, Math.min(1, vol));

    for (let i = 0; i < barCount; i++) {
      const p = i / barCount;

      // Harmonic sine waves with distinct frequencies and phase shifts
      const wave1 = Math.sin(t * 3.2 + i * 0.35);
      const wave2 = Math.sin(t * 5.6 - i * 0.65 + 1.1);
      const wave3 = Math.cos(t * 8.4 + i * 0.95 + 2.3);
      const wave4 = Math.sin(t * 12.0 - i * 1.4);

      // Low frequency rhythmic kick for bass bins (left side)
      const bassBeat = Math.max(0, Math.sin(t * 4.0)) * Math.max(0, 1 - p * 2.5) * 0.4;

      // Natural audio frequency roll-off curve (bass/mids higher amplitude than top treble)
      const spectralCurve = 0.4 + 0.6 * Math.sin(Math.min(1, p * 1.4) * Math.PI * 0.5);

      // Combine harmonics into normalized [0, 1] range
      const combined = (wave1 * 0.35 + wave2 * 0.28 + wave3 * 0.22 + wave4 * 0.15 + 1) / 2;
      let val = (combined * spectralCurve + bassBeat) * volScale;
      val = Math.max(0.05, Math.min(1, val));

      const barH = Math.max(2, val * h);
      const x = i * (barW + gap);
      const y = h - barH;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.4 + val * 0.6;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barW, barH, 2);
      } else {
        ctx.rect(x, y, barW, barH);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSynthesizedWave(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, t: number, vol: number) {
    if (vol === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();

    const points = 48;
    const sliceW = w / points;
    const volScale = Math.max(0, Math.min(1, vol));
    const midY = h / 2;

    for (let i = 0; i <= points; i++) {
      const p = i / points;
      const wave = (
        Math.sin(t * 3.5 + p * Math.PI * 4) * 0.5 +
        Math.sin(t * 7.2 - p * Math.PI * 6 + 1.0) * 0.3 +
        Math.cos(t * 11.0 + p * Math.PI * 2) * 0.2
      ) * volScale;
      const y = midY + wave * (h * 0.4);
      const x = i * sliceW;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawSynthesizedBlurPulse(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, t: number, vol: number) {
    if (vol === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);

    const volScale = Math.max(0, Math.min(1, vol));
    const pulse = (Math.sin(t * 3.2) * 0.35 + Math.sin(t * 6.4 + 1.2) * 0.15 + 0.5) * volScale;
    const energy = Math.max(0, Math.min(1, pulse));

    const cx = w / 2;
    const cy = h / 2;
    const r = (Math.min(w, h) / 2 - 2) * (0.4 + energy * 0.6);

    const safeColor = normalizeColor(color);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
    grad.addColorStop(0, safeColor + 'cc');
    grad.addColorStop(1, safeColor + '00');

    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ── Animation loop ─────────────────────────────────────────────────────────

  function draw(timestamp?: number) {
    const mode = $theme.animation.playerVisualization;
    const reduced = $theme.animation.reducedMotion;
    const playing = $isPlaying;

    if (!canvas || !ctx2d || mode === 'none' || reduced || !playing || $isBackgroundFrozen || (typeof document !== 'undefined' && document.hidden)) {
      if (ctx2d && canvas) ctx2d.clearRect(0, 0, width, height);
      rafId = null;
      return;
    }

    rafId = requestAnimationFrame(draw);

    if ($volume === 0) {
      ctx2d.clearRect(0, 0, width, height);
      return;
    }

    const analyser = getHtml5Analyser();
    const w = width;
    const h = height;

    try {
      if (analyser) {
        switch (mode) {
          case 'bars':       drawBars(analyser, ctx2d, w, h, accentColor); break;
          case 'wave':       drawWave(analyser, ctx2d, w, h, accentColor); break;
          case 'blur-pulse': drawBlurPulse(analyser, ctx2d, w, h, accentColor); break;
        }
      } else {
        const t = (timestamp || performance.now()) / 1000;
        const vol = $volume;
        switch (mode) {
          case 'bars':       drawSynthesizedBars(ctx2d, w, h, accentColor, t, vol); break;
          case 'wave':       drawSynthesizedWave(ctx2d, w, h, accentColor, t, vol); break;
          case 'blur-pulse': drawSynthesizedBlurPulse(ctx2d, w, h, accentColor, t, vol); break;
        }
      }
    } catch (err) {
      console.warn('[AudioVisualizer] Draw frame error:', err);
    }
  }

  function startLoop() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(draw);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // React to play state, mode changes, and offstage freeze
  $: if (!$isBackgroundFrozen && $isPlaying && $theme.animation.playerVisualization !== 'none' && !$theme.animation.reducedMotion) {
    if (typeof document === 'undefined' || !document.hidden) {
      startLoop();
    }
  } else {
    stopLoop();
    if (ctx2d && canvas) ctx2d.clearRect(0, 0, width, height);
  }

  // Sync canvas resolution to CSS size
  $: if (canvas) {
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx2d = canvas.getContext('2d');
    if (ctx2d) ctx2d.scale(dpr, dpr);
  }

  function handleVisibilityChange() {
    if (typeof document !== 'undefined' && document.hidden) {
      stopLoop();
    } else if (!$isBackgroundFrozen && $isPlaying && $theme.animation.playerVisualization !== 'none' && !$theme.animation.reducedMotion) {
      startLoop();
    }
  }

  onMount(() => {
    ctx2d = canvas.getContext('2d');
    accentColor = getAccent();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (!$isBackgroundFrozen && $isPlaying && $theme.animation.playerVisualization !== 'none' && !$theme.animation.reducedMotion) {
      if (typeof document === 'undefined' || !document.hidden) {
        startLoop();
      }
    }
  });

  onDestroy(() => {
    stopLoop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  });
</script>

<canvas
  bind:this={canvas}
  style="width:{width}px;height:{height}px;display:block;"
  aria-hidden="true"
></canvas>
