<script lang="ts">
  // frequency response graph for the parametric eq
  // draggable dots for each band's frequency/gain
  //
  // uses real BiquadFilterNode.getFrequencyResponse via a throwaway OfflineAudioContext
  // guarantees the curve matches what actually plays on the HTML5 backend
  // closely tracks the native backend too
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import {
    equalizer,
    MIN_FREQ,
    MAX_FREQ,
    type EqualizerBand,
  } from '$lib/stores/equalizer';

  export let selectedBandIndex: number | null = null;

  const dispatch = createEventDispatcher<{ select: number | null; add: number }>();

  const GRAPH_MIN_DB = -18;
  const GRAPH_MAX_DB = 18;
  const LOG_MIN = Math.log10(MIN_FREQ);
  const LOG_MAX = Math.log10(MAX_FREQ);
  const CURVE_POINTS = 220;

  const GAINLESS = new Set(['lowPass', 'highPass', 'bandPass', 'notch', 'allPass']);

  let containerEl: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let width = 600;
  let height = 220;
  let dpr = 1;

  let offlineCtx: OfflineAudioContext | null = null;
  let scratchFilter: BiquadFilterNode | null = null;
  let freqArray: Float32Array<ArrayBuffer> | null = null;
  let magOut: Float32Array<ArrayBuffer> | null = null;
  let phaseOut: Float32Array<ArrayBuffer> | null = null;

  let dragIndex: number | null = null;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let rafId: number | null = null;

  function xToFreq(x: number): number {
    const t = Math.max(0, Math.min(1, x / width));
    return Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
  }
  function freqToX(freq: number): number {
    const t = (Math.log10(Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq))) - LOG_MIN) / (LOG_MAX - LOG_MIN);
    return t * width;
  }
  function yToDb(y: number): number {
    const t = Math.max(0, Math.min(1, y / height));
    return GRAPH_MAX_DB - t * (GRAPH_MAX_DB - GRAPH_MIN_DB);
  }
  function dbToY(db: number): number {
    const t = (GRAPH_MAX_DB - db) / (GRAPH_MAX_DB - GRAPH_MIN_DB);
    return Math.max(0, Math.min(1, t)) * height;
  }

  function ensureAnalysisNodes() {
    if (offlineCtx) return;
    try {
      offlineCtx = new OfflineAudioContext(1, 2, 44100);
      scratchFilter = offlineCtx.createBiquadFilter();
      freqArray = new Float32Array(CURVE_POINTS);
      for (let i = 0; i < CURVE_POINTS; i++) {
        freqArray[i] = xToFreq((i / (CURVE_POINTS - 1)) * width);
      }
      magOut = new Float32Array(CURVE_POINTS);
      phaseOut = new Float32Array(CURVE_POINTS);
    } catch (err) {
      console.warn('[EqResponseCurve] OfflineAudioContext unavailable, curve disabled:', err);
    }
  }

  // combined |H(f)| in dB across all active bands, plus preamp trim
  function computeCurve(bands: EqualizerBand[], enabled: boolean, preampDb: number): Float32Array {
    const combinedDb = new Float32Array(CURVE_POINTS);
    if (!enabled || !offlineCtx || !scratchFilter || !freqArray || !magOut || !phaseOut) {
      return combinedDb; // flat 0 dB line
    }

    const combinedLinear = new Float32Array(CURVE_POINTS).fill(1);

    for (const band of bands) {
      if (!band.enabled) continue;
      const needsGain = !GAINLESS.has(band.filterType);
      if (needsGain && Math.abs(band.gain) < 0.01) continue;

      scratchFilter.type = WEBAUDIO_TYPE[band.filterType] ?? 'peaking';
      scratchFilter.frequency.value = Math.min(band.frequency, offlineCtx.sampleRate / 2 * 0.998);
      scratchFilter.Q.value = Math.max(0.1, Math.min(10, band.q));
      scratchFilter.gain.value = needsGain ? band.gain : 0;

      scratchFilter.getFrequencyResponse(freqArray, magOut, phaseOut);
      for (let i = 0; i < CURVE_POINTS; i++) {
        combinedLinear[i] *= magOut[i];
      }
    }

    const preampLinear = Math.pow(10, preampDb / 20);
    for (let i = 0; i < CURVE_POINTS; i++) {
      combinedDb[i] = 20 * Math.log10(Math.max(1e-6, combinedLinear[i] * preampLinear));
    }
    return combinedDb;
  }

  const WEBAUDIO_TYPE: Record<string, BiquadFilterType> = {
    peaking: 'peaking',
    lowShelf: 'lowshelf',
    highShelf: 'highshelf',
    lowPass: 'lowpass',
    highPass: 'highpass',
    bandPass: 'bandpass',
    notch: 'notch',
    allPass: 'allpass',
  };

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const gridColor = styles.getPropertyValue('--border-color').trim() || 'rgba(255,255,255,0.08)';
    const textColor = styles.getPropertyValue('--text-subdued').trim() || 'rgba(255,255,255,0.4)';
    const accent = styles.getPropertyValue('--accent-primary').trim() || '#1db954';
    const accentRgb = styles.getPropertyValue('--accent-rgb').trim() || '29, 185, 84';

    // grid: frequency lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '9px sans-serif';
    ctx.fillStyle = textColor;
    const freqTicks = [30, 100, 300, 1000, 3000, 10000];
    for (const f of freqTicks) {
      const x = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, height - 4);
    }
    // grid: dB lines
    const dbTicks = [-12, -6, 0, 6, 12];
    for (const db of dbTicks) {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 2, y - 2);
    }
    // 0 dB baseline, slightly stronger
    ctx.strokeStyle = textColor;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, dbToY(0));
    ctx.lineTo(width, dbToY(0));
    ctx.stroke();
    ctx.globalAlpha = 1;

    const state = $equalizer;
    const curve = computeCurve(state.bands, state.enabled, state.preampDb);

    // curve + gradient fill from the curve down to the 0 dB baseline
    const baseline = dbToY(0);
    ctx.beginPath();
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i / (CURVE_POINTS - 1)) * width;
      const y = dbToY(curve[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `rgba(${accentRgb}, 0.35)`);
    gradient.addColorStop(0.5, `rgba(${accentRgb}, 0.12)`);
    gradient.addColorStop(1, `rgba(${accentRgb}, 0.35)`);
    ctx.lineTo(width, baseline);
    ctx.lineTo(0, baseline);
    ctx.closePath();
    ctx.fillStyle = state.enabled ? gradient : 'rgba(128,128,128,0.08)';
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i / (CURVE_POINTS - 1)) * width;
      const y = dbToY(curve[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = state.enabled ? accent : textColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // band dots
    state.bands.forEach((band, i) => {
      const x = freqToX(band.frequency);
      const y = GAINLESS.has(band.filterType) ? dbToY(0) : dbToY(band.gain);
      const isSelected = selectedBandIndex === i;
      const isBypassed = !band.enabled;

      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isBypassed ? 'rgba(128,128,128,0.5)' : (isSelected ? accent : `rgba(${accentRgb}, 0.75)`);
      ctx.fill();
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = styles.getPropertyValue('--bg-base').trim() || '#000';
      ctx.stroke();
    });

    ctx.restore();
  }

  function scheduleDraw() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      draw();
    });
  }

  function hitTestBand(x: number, y: number): number | null {
    const state = $equalizer;
    let best: number | null = null;
    let bestDist = 14; // px hit radius
    state.bands.forEach((band, i) => {
      const bx = freqToX(band.frequency);
      const by = GAINLESS.has(band.filterType) ? dbToY(0) : dbToY(band.gain);
      const d = Math.hypot(x - bx, y - by);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  function getLocalPos(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent) {
    const { x, y } = getLocalPos(e);
    const hit = hitTestBand(x, y);
    dragIndex = hit;
    dragMoved = false;
    dragStartX = x;
    dragStartY = y;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragIndex === null) return;
    const { x, y } = getLocalPos(e);
    if (Math.hypot(x - dragStartX, y - dragStartY) > 2) dragMoved = true;

    const band = $equalizer.bands[dragIndex];
    if (!band) return;
    const freq = xToFreq(x);
    equalizer.setBandFrequency(dragIndex, freq);
    if (!GAINLESS.has(band.filterType)) {
      equalizer.setBandGain(dragIndex, yToDb(y));
    }
  }

  function onPointerUp(e: PointerEvent) {
    const { x, y } = getLocalPos(e);
    if (dragIndex !== null && !dragMoved) {
      // clean click on an existing dot => select it
      selectedBandIndex = dragIndex;
      dispatch('select', dragIndex);
    } else if (dragIndex === null) {
      // clean click on empty space => add a band there
      const freq = xToFreq(x);
      const gain = yToDb(y);
      const newIndex = equalizer.addBand(Math.round(freq));
      if (newIndex >= 0) {
        equalizer.setBandGain(newIndex, gain);
        selectedBandIndex = newIndex;
        dispatch('select', newIndex);
        dispatch('add', newIndex);
      }
    }
    dragIndex = null;
    dragMoved = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTestBand(x, y);
    if (hit !== null) {
      equalizer.removeBand(hit);
      if (selectedBandIndex === hit) selectedBandIndex = null;
      else if (selectedBandIndex !== null && selectedBandIndex > hit) selectedBandIndex -= 1;
    }
  }

  function resize() {
    if (!containerEl) return;
    width = containerEl.clientWidth;
    height = containerEl.clientHeight;
    dpr = window.devicePixelRatio || 1;
    if (canvas) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ensureAnalysisNodes();
    scheduleDraw();
  }

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    ensureAnalysisNodes();
    resize();
    resizeObserver = new ResizeObserver(() => resize());
    if (containerEl) resizeObserver.observe(containerEl);
    const unsub = equalizer.subscribe(() => scheduleDraw());
    return () => {
      unsub();
    };
  });

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
  });

  $: if (canvas) { selectedBandIndex; scheduleDraw(); }
</script>

<div class="eq-graph-container" bind:this={containerEl}>
  <canvas
    bind:this={canvas}
    style="width: {width}px; height: {height}px;"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:contextmenu={onContextMenu}
  ></canvas>
  <p class="eq-graph-hint">Drag a point to adjust frequency and gain · click empty space to add a band · right-click a point to remove it</p>
</div>

<style>
  .eq-graph-container {
    width: 100%;
    height: 260px;
    position: relative;
    border-radius: var(--radius-md);
    background: var(--bg-highlight);
    border: 1px solid var(--border-color);
    overflow: hidden;
  }
  canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .eq-graph-hint {
    position: absolute;
    bottom: 4px;
    right: 8px;
    margin: 0;
    font-size: 0.65rem;
    color: var(--text-subdued);
    pointer-events: none;
    opacity: 0.8;
  }
</style>