<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { meshColors } from "$lib/stores/palette";
  import { meshSettings } from "$lib/stores/meshSettings";

  export let lite = false; // pass true for android-lite path

  let canvas: HTMLCanvasElement;
  let worker: Worker;
  let unsubColors: () => void;
  let unsubSettings: () => void;
  let initialized = false;

  onMount(() => {
    if (lite) return; // skip worker/canvas entirely on lite path

    worker = new Worker(new URL("./mesh-worker.ts", import.meta.url), {
      type: "module",
    });

    const offscreen = canvas.transferControlToOffscreen();
    const s = $meshSettings;
    worker.postMessage(
      {
        type: "init",
        canvas: offscreen,
        colors: $meshColors,
        speed: s.speed,
        quality: s.quality,
        enabled: s.enabled,
        spread: s.spread,
        sharpness: s.sharpness,
      },
      [offscreen],
    );
    initialized = true;

    unsubColors = meshColors.subscribe((colors) => {
      worker.postMessage({ type: "colors", colors });
    });

    unsubSettings = meshSettings.subscribe((settings) => {
      if (!initialized) return;
      worker.postMessage({
        type: "settings",
        speed: settings.speed,
        quality: settings.quality,
        enabled: settings.enabled,
        spread: settings.spread,
        sharpness: settings.sharpness,
      });
    });
  });

  onDestroy(() => {
    unsubColors?.();
    unsubSettings?.();
    worker?.terminate();
  });

  // Lite mode: static gradient driven by CSS custom properties
  $: liteStyle = lite
    ? `--c0:${$meshColors[0]};--c1:${$meshColors[1]};--c2:${$meshColors[2]};--c3:${$meshColors[3]}`
    : "";

  $: canvasStyle = $meshSettings.enabled
    ? `filter: blur(${$meshSettings.blur}px) saturate(${$meshSettings.saturation}); opacity: ${$meshSettings.opacity};`
    : `opacity: 0;`;
</script>

{#if lite}
  {#if $meshSettings.enabled}
    <div class="mesh-fallback" style={liteStyle}></div>
  {/if}
{:else}
  <canvas bind:this={canvas} class="mesh-canvas" style={canvasStyle}></canvas>
{/if}

<style>
  .mesh-canvas {
    position: absolute;
    inset: -20%;
    width: 140%;
    height: 140%;
    image-rendering: auto;
  }

  .mesh-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.45;
    transition: background 0.6s ease;
    background:
      radial-gradient(circle at 20% 25%, var(--c0, #0a0a0a) 0%, transparent 60%),
      radial-gradient(circle at 80% 25%, var(--c1, #0a0a0a) 0%, transparent 60%),
      radial-gradient(circle at 20% 80%, var(--c2, #0a0a0a) 0%, transparent 60%),
      radial-gradient(circle at 80% 80%, var(--c3, #0a0a0a) 0%, transparent 60%),
      #0a0a0a;
  }
</style>