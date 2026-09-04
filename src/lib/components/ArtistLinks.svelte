<script lang="ts">
  // renders a track's artist(s) as individually clickable names
  //
  // two modes:
  // - full (default): every artist rendered as its own clickable chip,
  //   separated visually by the normalized "·" separator
  //   use this in track rows / lists where there's room
  // - compact: only the first artist is shown, clickable, followed by a
  //   plain (non interactive) ellipsis if there are more
  //   use this in tight spaces (mini players, now playing bars, notifications) where a full multi artist chip row won't fit
  //
  // falls back to rendering the raw artist string (single, still clickable as one chip) 
  // if artists is empty or undefined
  //
  // optional marquee support (full mode only): when marquee is set
  // the chip row is wrapped in the centralized MarqueeText component
  // marqueeTrigger controls how it starts see MarqueeText.svelte for full doc
  // not supported in compact mode => collapses to a single chip plus a plain ellipsis
  //
  // optional tap menu (compact mode only):
  // when tapMenu is set and there's more than one artist
  // tapping the chip opens a popover listing every artist

  import { createEventDispatcher, tick } from "svelte";
  import MarqueeText from "$lib/components/MarqueeText.svelte";

  export let artist: string | null | undefined = null;
  export let artists: string[] | null | undefined = undefined;
  export let compact = false;
  /** optional class applied to each artist chip button */
  export let chipClass = "";
  /** optional class applied to the wrapping element */
  export let wrapClass = "";
  /** optional marquee scrolling for an overflowing chip row (full mode only) */
  export let marquee = false;
  /** hover (self contained), external (driven by marqueeActive), or always */
  export let marqueeTrigger: "hover" | "external" | "always" = "hover";
  /** only used when marqueeTrigger=external: caller controlled start/stop */
  export let marqueeActive = false;
  /** marquee scroll speed in px/second, passed through to MarqueeText */
  export let marqueeSpeed = 40;
  /**
   * passed through to MarqueeText => reset scroll position when this changes
   */
  export let resetKey: unknown = undefined;
  /** optional artist picker popover for touch surfaces (compact mode only) */
  export let tapMenu = false;
  /** optional title/tooltip applied to each artist chip button */
  export let chipTitle = "";

  const dispatch = createEventDispatcher<{ select: string }>();

  $: names = artists && artists.length > 0 ? artists : artist ? [artist] : [];
  $: useMarquee = marquee && !compact;
  $: useTapMenu = tapMenu && compact && names.length > 1;

  let menuOpen = false;
  let menuEl: HTMLDivElement;
  let menuX = 0;
  let menuY = 0;

  function handleClick(e: MouseEvent, name: string) {
    e.stopPropagation();
    dispatch("select", name);
  }

  function handleKeydown(e: KeyboardEvent, name: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      dispatch("select", name);
    }
  }

  async function openTapMenu(e: MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menuX = rect.left;
    menuY = rect.bottom + 4;
    menuOpen = true;
    await tick();
    if (!menuEl) return;
    const { innerWidth, innerHeight } = window;
    const menuRect = menuEl.getBoundingClientRect();
    if (menuX + menuRect.width > innerWidth) {
      menuX = innerWidth - menuRect.width - 8;
    }
    if (menuY + menuRect.height > innerHeight) {
      // flip above the trigger instead of overflowing past the bottom edge
      menuY = rect.top - menuRect.height - 4;
    }
    menuX = Math.max(8, menuX);
    menuY = Math.max(8, menuY);
  }

  function closeTapMenu() {
    menuOpen = false;
  }

  function selectFromMenu(name: string) {
    closeTapMenu();
    dispatch("select", name);
  }

  function handleWindowClick(e: MouseEvent) {
    if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) {
      closeTapMenu();
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (menuOpen && e.key === "Escape") {
      closeTapMenu();
    }
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

{#if names.length === 0}
  <span class="artist-links-empty {wrapClass}">Unknown Artist</span>
{:else if compact}
  <span class="artist-links-compact {wrapClass}">
    <button
      type="button"
      class="artist-chip {chipClass}"
      title={chipTitle}
      on:click={(e) => (useTapMenu ? openTapMenu(e) : handleClick(e, names[0]))}
      on:keydown={(e) => handleKeydown(e, names[0])}
    >{names[0]}</button>
    {#if names.length > 1}
      <span
        class="artist-links-ellipsis"
        class:tappable={useTapMenu}
        title={useTapMenu ? "" : names.slice(1).join(" · ")}
        on:click={(e) => useTapMenu && openTapMenu(e)}
      >&nbsp;…</span>
    {/if}
  </span>
  {#if menuOpen}
    <div
      class="artist-tap-menu"
      bind:this={menuEl}
      style="left: {menuX}px; top: {menuY}px;"
      role="menu"
    >
      {#each names as name (name)}
        <button
          type="button"
          class="artist-tap-menu-item"
          role="menuitem"
          on:click|stopPropagation={() => selectFromMenu(name)}
        >{name}</button>
      {/each}
    </div>
  {/if}
{:else if useMarquee}
  <MarqueeText
    trigger={marqueeTrigger}
    active={marqueeActive}
    pauseOnHover="freeze"
    speed={marqueeSpeed}
    {resetKey}
    containerClass={wrapClass}
  >
    <span class="artist-links-full">
      {#each names as name, i (name)}
        <button
          type="button"
          class="artist-chip {chipClass}"
          title={chipTitle}
          on:click={(e) => handleClick(e, name)}
          on:keydown={(e) => handleKeydown(e, name)}
        >{name}</button>
        {#if i < names.length - 1}<span class="artist-links-sep">·</span>{/if}
      {/each}
    </span>
  </MarqueeText>
{:else}
  <span class="artist-links-full {wrapClass}">
    {#each names as name, i (name)}
      <button
        type="button"
        class="artist-chip {chipClass}"
        title={chipTitle}
        on:click={(e) => handleClick(e, name)}
        on:keydown={(e) => handleKeydown(e, name)}
      >{name}</button>
      {#if i < names.length - 1}<span class="artist-links-sep">·</span>{/if}
    {/each}
  </span>
{/if}

<style>
  .artist-links-full,
  .artist-links-compact {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3em;
    min-width: 0;
  }

  .artist-chip {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artist-chip:hover {
    text-decoration: underline;
  }

  .artist-links-sep {
    opacity: 0.5;
    flex-shrink: 0;
  }

  .artist-links-ellipsis {
    opacity: 0.6;
    cursor: default;
    flex-shrink: 0;
  }

  .artist-links-ellipsis.tappable {
    cursor: pointer;
    opacity: 0.9;
  }

  .artist-links-empty {
    opacity: 0.6;
  }

  .artist-tap-menu {
    position: fixed;
    z-index: 1000;
    min-width: 140px;
    max-width: 260px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--surface-elevated, #222);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .artist-tap-menu-item {
    background: none;
    border: none;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artist-tap-menu-item:hover,
  .artist-tap-menu-item:focus-visible {
    background: var(--surface-hover, rgba(255, 255, 255, 0.08));
  }
</style>