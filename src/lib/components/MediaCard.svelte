<script lang="ts">
  import { _ } from "svelte-i18n";
  import { createEventDispatcher, onDestroy } from "svelte";
  import MarqueeText from "$lib/components/MarqueeText.svelte";

  const dispatch = createEventDispatcher<{
    play: void;
    pause: void;
    click: MouseEvent;
  }>();

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
  export let isPinned = false;

  $: isRound = variant === "round";
  $: isCentered = variant === "round";

  // hover => drives both this card's own title/subtitle marquee
  // via MarqueeText's external trigger below
  // exposed to the secondary slot so callers (e.g. ArtistLinks chips)
  // can sync their own marquee to the same whole card hover
  let isActive = false;
  let touchTimeout: ReturnType<typeof setTimeout> | null = null;
  // fixed window to keep a touch triggered marquee visible before it
  const TOUCH_MARQUEE_MS = 8000;

  function handleMouseEnter() {
    isActive = true;
  }

  function handleMouseLeave() {
    isActive = false;
  }

  function handleTouchStart(e: TouchEvent) {
    const target = e.target as HTMLElement;
    if (
      target.closest(".play-button") ||
      target.closest(".pause-button-overlay")
    )
      return;
    if (touchTimeout) clearTimeout(touchTimeout);

    isActive = true;

    touchTimeout = setTimeout(() => {
      isActive = false;
    }, TOUCH_MARQUEE_MS);
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
  on:click={(e) => dispatch("click", e)}
>
  {#if isNowPlaying}
    <div class="badge" aria-hidden="true">{$_('player.nowPlaying')}</div>
  {:else if isPaused}
    <div class="badge paused-badge" aria-hidden="true">{$_('player.paused')}</div>
  {/if}

  <div
    class="cover"
    class:round={isRound}
    style={coverBackground ? `--card-cover-bg: ${coverBackground};` : ""}
  >
    <slot name="cover" />

    {#if isPinned}
      <div class="pinned-indicator" aria-label="Pinned to top">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path
            d="M16 9V4l1 0V2H7v2l1 0v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
          />
        </svg>
      </div>
    {/if}

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
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="24"
            height="24"
            aria-hidden="true"
          >
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
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="24"
            height="24"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="info">
    <MarqueeText
      trigger="external"
      active={isActive}
      resetKey={primaryText}
      containerClass="text-track"
    >
      <span class="text-inner">{primaryText}</span>
    </MarqueeText>

    {#if $$slots.secondary}
      <div class="text-track secondary">
        <slot name="secondary" {isActive} />
      </div>
    {:else if secondaryText}
      <MarqueeText
        trigger="external"
        active={isActive}
        resetKey={secondaryText}
        containerClass="text-track secondary"
      >
        {#if secondaryAction}
          <button
            class="text-inner secondary-link"
            on:click|stopPropagation={secondaryAction}>{secondaryText}</button
          >
        {:else}
          <span class="text-inner">{secondaryText}</span>
        {/if}
      </MarqueeText>
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
    cursor: pointer;
    user-select: none;
  }

  .media-card:hover {
    background-color: var(--bg-surface);
  }
  .media-card.now-playing {
    background-color: var(--accent-subtle);
  }
  .media-card.now-playing:hover,
  .media-card.paused,
  .media-card.paused:hover {
    background-color: var(--accent-subtle);
    opacity: 0.95;
  }

  /* Round / centered variant */
  .media-card.centered {
    align-items: center;
    text-align: center;
  }
  .media-card.centered .info {
    align-items: center;
    width: 100%;
  }
  .media-card.centered :global(.text-track) {
    /* shrink-to-fit + auto margins: when the content is narrower than the card, this centers it
    once content is wide enough to hit max-width:100%, it falls back to flush-left with the overflow clipped */
    width: max-content;
    max-width: 100%;
    margin: 0 auto;
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
    .cover.round {
      width: 100px;
      height: 100px;
    }
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
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    pointer-events: none;
    z-index: 2;
  }

  .badge.paused-badge {
    background-color: var(--text-secondary);
  }

  /* Pinned Indicator */
  .pinned-indicator {
    position: absolute;
    top: var(--spacing-sm);
    right: var(--spacing-sm);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-md);
    z-index: 2;
  }

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

  .cover:hover .cover-overlay {
    opacity: 1;
    pointer-events: auto;
  }
  .cover-overlay.is-playing {
    opacity: 0;
    background: transparent;
  }
  .cover:hover .cover-overlay.is-playing {
    opacity: 1;
    background: rgba(0, 0, 0, 0.5);
  }

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
    transition:
      transform var(--transition-fast),
      scale var(--transition-fast);
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
    font-size: var(--font-size-xs);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-fast);
    box-shadow: var(--shadow-md);
    z-index: 1000;
  }

  .play-button:hover::after {
    opacity: 1;
  }
  .cover:hover .play-button {
    transform: translateY(0);
  }
  .play-button:hover {
    transform: translateY(0) scale(1.05);
  }

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

  .playing-indicator:hover {
    transform: scale(1.05);
  }

  .playing-indicator .bar {
    width: 4px;
    height: 16px;
    background-color: var(--bg-base);
    border-radius: 2px;
    animation: equalizer 0.8s ease-in-out infinite;
  }

  .playing-indicator .bar:nth-child(2) {
    animation-delay: 0.2s;
  }
  .playing-indicator .bar:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes equalizer {
    0%,
    100% {
      height: 6px;
    }
    50% {
      height: 20px;
    }
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

  .playing-indicator-container:hover .pause-button-overlay {
    opacity: 1;
  }

  .pause-button-overlay::after {
    content: attr(data-pause-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-fast);
    box-shadow: var(--shadow-md);
    z-index: 1000;
  }

  .pause-button-overlay:hover::after {
    opacity: 1;
  }

  /* Info */
  .info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    min-height: 0;
    overflow: hidden;
  }

  /* Marquee: 
  overflow/scroll animation lives in the shared
  MarqueeText component
  these rules just style the text and layout, not the motion
  svelte only allows :global to wrap a whole selector or a leading/trailing segment of it, not an inner segment
  so each rule below wraps its entire selector */
  :global(.text-inner) {
    white-space: nowrap;
    flex-shrink: 0;
  }

  :global(.text-track:not(.secondary) .text-inner) {
    font-size: 0.9375rem;
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  :global(.media-card.now-playing .text-track:not(.secondary) .text-inner),
  :global(.media-card.paused .text-track:not(.secondary) .text-inner) {
    color: var(--accent-primary);
  }

  :global(.text-track.secondary .text-inner) {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  :global(.media-card.now-playing .text-track.secondary .text-inner),
  :global(.media-card.paused .text-track.secondary .text-inner) {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  /* Secondary text as a clickable button
  global wrapped for the same reason above
  used cross component via chipClass="... secondary-link" passed to ArtistLinks */
  :global(.secondary-link) {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  :global(.secondary-link:hover) {
    text-decoration: underline;
    color: var(--text-primary);
  }

  :global(.media-card.now-playing .secondary-link),
  :global(.media-card.paused .secondary-link) {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  :global(.media-card.now-playing .secondary-link:hover),
  :global(.media-card.paused .secondary-link:hover) {
    opacity: 1;
  }

  /* Mobile */
  @media (max-width: 768px) {
    .media-card {
      padding: var(--spacing-sm);
    }
    .cover {
      margin-bottom: var(--spacing-sm);
    }
    :global(.text-track:not(.secondary)) .text-inner {
      font-size: var(--font-size-sm);
    }
    :global(.text-track.secondary) .text-inner {
      font-size: var(--font-size-xs);
    }
    .badge {
      font-size: 0.625rem;
      padding: 2px 6px;
    }
  }
</style>
