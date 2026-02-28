<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";

  const dispatch = createEventDispatcher<{ play: void; pause: void }>();

  export let isNowPlaying = false;
  export let isPaused = false;
  export let playTooltip = "Play";
  export let resumeTooltip = "Resume";
  export let pauseTooltip = "Pause";
  export let ariaLabel = "";
  export let variant: "square" | "round" = "square";
  export let coverBackground = "";
  export let primaryText = "";
  export let secondaryText = "";
  // If provided, secondary text renders as a clickable button
  export let secondaryAction: (() => void) | null = null;

  $: isRound = variant === "round";
  $: isCentered = variant === "round";

  // Marquee
  let primaryEl: HTMLSpanElement;
  let secondaryEl: HTMLSpanElement;

  let primaryOverflows = false;
  let secondaryOverflows = false;
  let primaryDuration = "0s";
  let secondaryDuration = "0s";

  let measureRafId: number | null = null;

  function measureOverflow(onDone?: () => void) {
    if (measureRafId !== null) cancelAnimationFrame(measureRafId);
    measureRafId = requestAnimationFrame(() => {
      measureRafId = null;
      if (primaryEl) {
        primaryOverflows = primaryEl.scrollWidth > primaryEl.clientWidth;
        if (primaryOverflows) {
          primaryDuration = `${Math.max(4, (primaryEl.scrollWidth + 64) / 60).toFixed(1)}s`;
        }
      }
      if (secondaryEl) {
        secondaryOverflows = secondaryEl.scrollWidth > secondaryEl.clientWidth;
        if (secondaryOverflows) {
          secondaryDuration = `${Math.max(4, (secondaryEl.scrollWidth + 64) / 60).toFixed(1)}s`;
        }
      }
      onDone?.();
    });
  }

  function resetOverflow() {
    if (measureRafId !== null) {
      cancelAnimationFrame(measureRafId);
      measureRafId = null;
    }
    primaryOverflows = false;
    secondaryOverflows = false;
    primaryDuration = "0s";
    secondaryDuration = "0s";
  }

  // Hover
  let isActive = false;
  let touchTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleMouseEnter() {
    isActive = true;
    measureOverflow();
  }

  function handleMouseLeave() {
    isActive = false;
    resetOverflow();
  }

  function handleTouchStart(e: TouchEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".play-button") || target.closest(".pause-button-overlay")) return;
    if (touchTimeout) clearTimeout(touchTimeout);

    isActive = true;
    
    measureOverflow(() => {
      const longest = Math.max(
        parseFloat(primaryDuration) || 0,
        parseFloat(secondaryDuration) || 0
      );
      touchTimeout = setTimeout(() => {
        isActive = false;
        resetOverflow();
      }, Math.min(Math.max(6000, longest * 2 * 1000), 10000));
    });
  }

  // Keyboard
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isNowPlaying) {
        dispatch("pause");
      } else {
        dispatch("play");
      }
    }
  }

  onDestroy(() => {
    if (touchTimeout) clearTimeout(touchTimeout);
    if (measureRafId !== null) {
      cancelAnimationFrame(measureRafId);
      measureRafId = null;
    }
  });
</script>

<div
  class="media-card"
  class:now-playing={isNowPlaying}
  class:paused={isPaused}
  class:centered={isCentered}
  role="button"
  tabindex="0"
  aria-label={ariaLabel || primaryText}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  on:touchstart={handleTouchStart}
  on:keydown={handleKeyDown}
>
  {#if isNowPlaying}
    <div class="badge" aria-hidden="true">Now Playing</div>
  {:else if isPaused}
    <div class="badge paused-badge" aria-hidden="true">Paused</div>
  {/if}

  <div
    class="cover"
    class:round={isRound}
    style={coverBackground ? `--card-cover-bg: ${coverBackground};` : ""}
  >
    <slot name="cover" />

    {#if isNowPlaying}
      <div class="playing-indicator-container">
        <div class="playing-indicator" aria-hidden="true">
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
        </div>
        <button
          class="pause-button-overlay"
          data-pause-tooltip={pauseTooltip}
          on:click|stopPropagation={() => dispatch("pause")}
          aria-label={pauseTooltip}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden="true">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        </button>
      </div>
    {/if}

    <div class="cover-overlay" class:is-playing={isNowPlaying}>
      {#if !isNowPlaying}
        <button
          class="play-button"
          data-mediacard-play
          data-play-tooltip={isPaused ? resumeTooltip : playTooltip}
          aria-label={isPaused ? resumeTooltip : playTooltip}
          on:click|stopPropagation={() => dispatch("play")}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="info">
    <div class="text-track" class:animate={isActive && primaryOverflows}>
      <span
        class="text-inner"
        bind:this={primaryEl}
        style="--marquee-duration: {primaryDuration};"
        class:marquee={isActive && primaryOverflows}
      >{primaryText}</span>
      {#if isActive && primaryOverflows}
        <span class="text-inner marquee" aria-hidden="true" style="--marquee-duration: {primaryDuration};">
          {primaryText}
        </span>
      {/if}
    </div>

    {#if secondaryText}
      <div class="text-track secondary" class:animate={isActive && secondaryOverflows}>
        {#if secondaryAction}
          <button
            class="text-inner secondary-link"
            bind:this={secondaryEl}
            style="--marquee-duration: {secondaryDuration};"
            class:marquee={isActive && secondaryOverflows}
            on:click|stopPropagation={secondaryAction}
          >{secondaryText}</button>
          {#if isActive && secondaryOverflows}
            <button
              class="text-inner secondary-link marquee"
              aria-hidden="true"
              style="--marquee-duration: {secondaryDuration};"
              on:click|stopPropagation={secondaryAction}
            >{secondaryText}</button>
          {/if}
        {:else}
          <span
            class="text-inner"
            bind:this={secondaryEl}
            style="--marquee-duration: {secondaryDuration};"
            class:marquee={isActive && secondaryOverflows}
          >{secondaryText}</span>
          {#if isActive && secondaryOverflows}
            <span class="text-inner marquee" aria-hidden="true" style="--marquee-duration: {secondaryDuration};">
              {secondaryText}
            </span>
          {/if}
        {/if}
      </div>
    {/if}

    <slot name="extra-info" />
  </div>
</div>

<style>
  .media-card {
    background-color: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    transition: background-color var(--transition-normal);
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
  }

  .media-card:hover { background-color: var(--bg-surface); }
  .media-card.now-playing { background-color: var(--accent-subtle); }
  .media-card.now-playing:hover,
  .media-card.paused,
  .media-card.paused:hover {
    background-color: var(--accent-subtle);
    opacity: 0.95;
  }

  /* Round / centered variant */
  .media-card.centered { align-items: center; text-align: center; }
  .media-card.centered .info { align-items: center; width: 100%; }
  .media-card.centered .text-track { width: 100%; }
  .media-card.centered .text-track:not(.animate) .text-inner {
    max-width: 100%;
    width: 100%;
    display: block;
    text-align: center;
  }

  /* Cover */
  .cover {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--card-cover-bg, var(--bg-surface));
    margin-bottom: var(--spacing-md);
    box-shadow: var(--shadow-md);
    flex-shrink: 0;
    isolation: isolate;
    max-height: calc(100% - 60px);
  }

  .cover.round {
    border-radius: var(--radius-full);
    width: 140px;
    height: 140px;
    aspect-ratio: unset;
  }

  @media (max-width: 768px) {
    .cover.round { width: 100px; height: 100px; }
  }


  .cover :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Badge */
  .badge {
    position: absolute;
    top: var(--spacing-sm);
    left: var(--spacing-sm);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 600;
    pointer-events: none;
    z-index: 2;
  }

  .badge.paused-badge { background-color: var(--text-secondary); }

  /* Cover overlay */
  .cover-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity var(--transition-fast);
    pointer-events: none;
  }

  .cover:hover .cover-overlay { opacity: 1; pointer-events: auto; }
  .cover-overlay.is-playing { opacity: 0; background: transparent; }
  .cover:hover .cover-overlay.is-playing { opacity: 1; background: rgba(0, 0, 0, 0.5); }

  /* Play button */
  .play-button {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateY(8px);
    transition: transform var(--transition-fast), scale var(--transition-fast);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    position: relative;
  }

  .play-button::after {
    content: attr(data-play-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-fast);
    box-shadow: var(--shadow-md);
    z-index: 1000;
  }

  .play-button:hover::after { opacity: 1; }
  .cover:hover .play-button { transform: translateY(0); }
  .play-button:hover { transform: translateY(0) scale(1.05); }

  /* Playing indicator */
  .playing-indicator-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    pointer-events: auto;
  }

  .playing-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 48px;
    height: 48px;
    background-color: var(--accent-primary);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-lg);
    transition: transform var(--transition-fast);
    position: relative;
  }

  .playing-indicator:hover { transform: scale(1.05); }

  .playing-indicator .bar {
    width: 4px;
    height: 16px;
    background-color: var(--bg-base);
    border-radius: 2px;
    animation: equalizer 0.8s ease-in-out infinite;
  }

  .playing-indicator .bar:nth-child(2) { animation-delay: 0.2s; }
  .playing-indicator .bar:nth-child(3) { animation-delay: 0.4s; }

  @keyframes equalizer {
    0%, 100% { height: 6px; }
    50% { height: 20px; }
  }

  /* Pause button overlay */
  .pause-button-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--accent-primary);
    border-radius: var(--radius-full);
    opacity: 0;
    transition: opacity var(--transition-fast);
    color: var(--bg-base);
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .playing-indicator-container:hover .pause-button-overlay { opacity: 1; }

  .pause-button-overlay::after {
    content: attr(data-pause-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-fast);
    box-shadow: var(--shadow-md);
    z-index: 1000;
  }

  .pause-button-overlay:hover::after { opacity: 1; }

  /* Info */
  .info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    min-height: 0;
    overflow: hidden;
  }

  /* Marquee */
  .text-track {
    position: relative;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 4%, black 92%, transparent 100%);
    mask-image: linear-gradient(to right, transparent 0%, black 4%, black 92%, transparent 100%);
  }

  .text-track:not(.animate) {
    -webkit-mask-image: none;
    mask-image: none;
  }

  .text-inner {
    white-space: nowrap;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .text-track:not(.secondary) .text-inner {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .media-card.now-playing .text-track:not(.secondary) .text-inner,
  .media-card.paused .text-track:not(.secondary) .text-inner { color: var(--accent-primary); }

  .text-track.secondary .text-inner {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .media-card.now-playing .text-track.secondary .text-inner,
  .media-card.paused .text-track.secondary .text-inner {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  /* Secondary text as a clickable button */
  .secondary-link {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .secondary-link:hover {
    text-decoration: underline;
    color: var(--text-primary);
  }

  .media-card.now-playing .secondary-link,
  .media-card.paused .secondary-link {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  .media-card.now-playing .secondary-link:hover,
  .media-card.paused .secondary-link:hover {
    opacity: 1;
  }

  .text-inner.marquee {
    overflow: visible;
    text-overflow: clip;
    max-width: none;
    padding-right: 64px;
    animation: marquee-scroll var(--marquee-duration) linear infinite;
  }

  @keyframes marquee-scroll {
    from { transform: translateX(0); }
    to { transform: translateX(-100%); }
  }

  /* Mobile */
  @media (max-width: 768px) {
    .media-card { padding: var(--spacing-sm); }
    .cover { margin-bottom: var(--spacing-sm); }
    .text-track:not(.secondary) .text-inner { font-size: 0.8125rem; }
    .text-track.secondary .text-inner { font-size: 0.75rem; }
    .badge { font-size: 0.625rem; padding: 2px 6px; }
  }
</style>