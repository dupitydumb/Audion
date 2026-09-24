<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { theme } from '$lib/stores/theme';
  import { isPlaying } from '$lib/stores/player';
  import { getHtml5Analyser } from '$lib/stores/player';

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

  function getAccent(): string {
    if (typeof document === 'undefined') return accentColor;
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary').trim() || accentColor;
  }

  $: if ($theme) {
    accentColor = getAccent();
  }

  // ── Draw modes ─────────────────────────────────────────────────────────────

  function drawBars(analyser: AnalyserNode, ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
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
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawWave(analyser: AnalyserNode, ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
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

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, color + 'cc');
    grad.addColorStop(1, color + '00');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ── Animation loop ─────────────────────────────────────────────────────────

  function draw() {
    const mode = $theme.animation.playerVisualization;
    const reduced = $theme.animation.reducedMotion;
    const playing = $isPlaying;

    if (!canvas || !ctx2d || mode === 'none' || reduced) {
      rafId = null;
      return;
    }

    const analyser = getHtml5Analyser();
    const w = canvas.width;
    const h = canvas.height;

    if (!analyser || !playing) {
      ctx2d.clearRect(0, 0, w, h);
      rafId = null;
      return;
    }

    rafId = requestAnimationFrame(draw);

    switch (mode) {
      case 'bars':       drawBars(analyser, ctx2d, w, h, accentColor); break;
      case 'wave':       drawWave(analyser, ctx2d, w, h, accentColor); break;
      case 'blur-pulse': drawBlurPulse(analyser, ctx2d, w, h, accentColor); break;
    }
  }

  function startLoop() {
    if (rafId !== null) return;
    draw();
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // React to play state and mode changes
  $: if ($isPlaying && $theme.animation.playerVisualization !== 'none' && !$theme.animation.reducedMotion) {
    startLoop();
  } else {
    stopLoop();
    if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Sync canvas resolution to CSS size
  $: if (canvas) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx2d = canvas.getContext('2d');
    if (ctx2d) ctx2d.scale(dpr, dpr);
  }

  onMount(() => {
    ctx2d = canvas.getContext('2d');
    accentColor = getAccent();
  });

  onDestroy(stopLoop);
</script>

<canvas
  bind:this={canvas}
  style="width:{width}px;height:{height}px;display:block;"
  aria-hidden="true"
></canvas>
