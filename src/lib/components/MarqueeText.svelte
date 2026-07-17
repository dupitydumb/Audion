<script lang="ts">
  // centralized marquee component
  //
  // three trigger modes:
  //
  // 1. hover (default): this component's own bounding box is both the thing we hover to start it and the text itself
  //   animates only while the pointer is over it, resets when the pointer leaves
  //   no freeze behavior here
  //
  // 2. external: start/stop is controlled by a parent via the 'active' prop
  //   e.g. a track row's own hover state :
  //      hover anywhere on the row and every marquee in it starts scrolling
  //      leave the row and it stops and resets
  //   independently, hovering the marquee's own bounding box directly always freezes it in place (regardless of active)
  //   moving off the text (but still within the still-active row)
  //   resumes scrolling from where it froze
  //
  // 3. always: scrolls continuously any time the content overflows,regardless of hover
  //   only for a single piece of text (e.g. a full screen player title)
  //   pauseOnHover controls what a direct hover on it does: 
  //      reset snaps back to the start (for plain non interactive text)
  //      freeze stops it place (for interactive content)
  //      none ignores hover entirely
  //
  // continuous one direction loop : 
  //    content is rendered twice, back to back with gap px of empty space between the two copies
  //    the track scrolls left at a constant speed (px/second)
  //    once it's scrolled exactly one copy width plus gap, position wraps via modulo
  //    the duplicate copy is inert + aria-hidden
  // slot based content

  import { onMount, onDestroy } from "svelte";

  /** scroll speed in px/second. constant always */
  export let speed = 40;
  /** one time delay (ms) before the loop starts scrolling after activating */
  export let pauseMs = 0;
  /** empty space (px) between the end of one copy and the start of the next */
  export let gap = 48;
  /** hover , external , always */
  export let trigger: "hover" | "external" | "always" = "hover";
  /** only used when trigger=external: parent controlled start/stop */
  export let active = false;
  /** only used when trigger=always: what a direct hover on it does */
  export let pauseOnHover: "reset" | "freeze" | "none" = "reset";
  /**
   * optional value to watch for content changes
   * (e.g. bind this to the current track's id)
   * so scroll position resets on a fresh pass rather han continuing mid scroll into unrelated new content
   */
  export let resetKey: unknown = undefined;

  export let containerClass = "";
  export let contentClass = "";

  /**
   * external mode only: when active goes false mid scroll, play exit animation
   * decelerate, shrink, snap back to start, restore size
   * set false to disable this and keep instant stop
   */
  export let exitAnimation = true;

  let containerEl: HTMLDivElement;
  let copyEl: HTMLDivElement;
  let containerWidth = 0;
  let contentWidth = 0;
  let offset = 0;
  let localHovering = false;
  let rafId: number | null = null;
  let phase: "pause-start" | "scrolling" = "pause-start";
  let phaseStart = 0;
  let lastResetKey: unknown = resetKey;
  let lastActive = active;
  let frozenSince: number | null = null;

  // exit sequence (scroll away) ==============================================
  // idle ->
  // decel (rAF, continues from live offset/speed) ->
  // recede (css transition: scale down) -> 
  // return (css transition: snap offset to 0 while small) ->
  // restore (CSS transition: scale back to 1) ->
  // idle
  const EXIT_DECEL_MS = 220;
  const EXIT_RECEDE_MS = 180;
  const EXIT_HOLD_SHRUNK_MS = 160;
  const EXIT_RETURN_MS = 320;
  const EXIT_HOLD_RETURNED_MS = 120;
  const EXIT_RESTORE_MS = 200;
  const EXIT_SHRINK_SCALE = 0.82;

  let exitPhase:
    | "idle"
    | "decel"
    | "recede"
    | "hold-shrunk"
    | "return"
    | "hold-returned"
    | "restore" = "idle";
  let scale = 1;
  let exitTimeouts: ReturnType<typeof setTimeout>[] = [];

  function clearExitTimeouts() {
    for (const id of exitTimeouts) clearTimeout(id);
    exitTimeouts = [];
  }

  $: loopDistance = contentWidth + gap;
  $: overflowing = contentWidth > containerWidth + 1;

  $: if (resetKey !== lastResetKey) {
    lastResetKey = resetKey;
    resetAnimation();
  }

  $: if (trigger === "external" && active !== lastActive) {
    lastActive = active;
    if (active) {
      if (exitPhase !== "idle") {
        // interrupted mid exit (scrolled back before it finished)
        // cancel the sequence and just resume normally
        clearExitTimeouts();
        exitPhase = "idle";
        scale = 1;
      }
      measure();
      resetAnimation();
      startLoop();
    } else if (exitAnimation && overflowing && phase === "scrolling") {
      startExit();
    } else {
      stopLoop();
      offset = 0;
      resetAnimation();
    }
  }

  function measure() {
    if (containerEl) containerWidth = containerEl.clientWidth;
    if (copyEl) contentWidth = copyEl.clientWidth;
  }

  function resetAnimation() {
    phase = "pause-start";
    offset = 0;
    phaseStart = 0;
    frozenSince = null;
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function startLoop() {
    if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(now: number) {
    if (!overflowing) {
      offset = 0;
      resetAnimation();
      rafId = null;
      return;
    }

    // freezing: always, for external mode, whenever the pointer is directly over the text
    // for always mode, only if pauseOnHover asks
    // hover mode has no separate freeze
    const shouldFreeze =
      localHovering &&
      (trigger === "external" ||
        (trigger === "always" && pauseOnHover === "freeze"));

    if (shouldFreeze) {
      if (frozenSince === null) frozenSince = now;
      rafId = requestAnimationFrame(tick);
      return; // don't advance, don't reset => stay exactly where it is
    }

    if (frozenSince !== null) {
      // just unfroze => shift phaseStart forward by exactly how long it was frozen
      // so the elapsed time calculation below resumes from the offset we were at
      phaseStart += now - frozenSince;
      frozenSince = null;
    }

    if (trigger === "always" && localHovering && pauseOnHover === "reset") {
      offset = 0;
      phase = "pause-start";
      phaseStart = now;
      rafId = requestAnimationFrame(tick);
      return;
    }

    if (phaseStart === 0) phaseStart = now;
    const elapsed = now - phaseStart;

    if (phase === "pause-start") {
      offset = 0;
      if (elapsed >= pauseMs) {
        phase = "scrolling";
        phaseStart = now;
      }
    } else {
      // continuous one direction loop: advance forever
      const dist = (elapsed / 1000) * speed;
      offset = loopDistance > 0 ? dist % loopDistance : 0;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startExit() {
    stopLoop();
    exitPhase = "decel";
    const decelStart = performance.now();
    const decelFromOffset = offset;
    // constant speed marquee decelerating to 0 over EXIT_DECEL_MS
    const decelDistance = (speed * EXIT_DECEL_MS) / 1000 / 2;

    function decelTick(now: number) {
      const t = Math.min((now - decelStart) / EXIT_DECEL_MS, 1);
      const eased = 1 - (1 - t) * (1 - t); // ease-out
      offset = decelFromOffset + decelDistance * eased;
      if (t < 1) {
        rafId = requestAnimationFrame(decelTick);
      } else {
        rafId = null;
        beginRecede();
      }
    }
    rafId = requestAnimationFrame(decelTick);
  }

  function beginRecede() {
    exitPhase = "recede";
    scale = EXIT_SHRINK_SCALE;
    exitTimeouts.push(setTimeout(beginHoldShrunk, EXIT_RECEDE_MS));
  }

  function beginHoldShrunk() {
    exitPhase = "hold-shrunk";
    exitTimeouts.push(setTimeout(beginReturn, EXIT_HOLD_SHRUNK_MS));
  }

  function beginReturn() {
    exitPhase = "return";
    // let the return transition class attach first, then change the offset on the next frame
    requestAnimationFrame(() => {
      offset = 0;
    });
    exitTimeouts.push(setTimeout(beginHoldReturned, EXIT_RETURN_MS));
  }

  function beginHoldReturned() {
    exitPhase = "hold-returned";
    exitTimeouts.push(setTimeout(beginRestore, EXIT_HOLD_RETURNED_MS));
  }

  function beginRestore() {
    exitPhase = "restore";
    scale = 1;
    exitTimeouts.push(setTimeout(finishExit, EXIT_RESTORE_MS));
  }

  function finishExit() {
    exitPhase = "idle";
    resetAnimation();
  }

  function handleMouseEnter() {
    localHovering = true;
    if (trigger === "hover") {
      measure();
      if (overflowing) {
        resetAnimation();
        startLoop();
      }
    }
    // external/always: local hover is picked up by tick() on its own
  }

  function handleMouseLeave() {
    localHovering = false;
    if (trigger === "hover") {
      stopLoop();
      offset = 0;
      resetAnimation();
    }
    // external/always: leaving the text resumes from wherever it froze
  }

  onMount(() => {
    if (trigger === "always") {
      measure();
      // fonts/images can still be settling right after mount
      // a couple of followup measurements a frame or two later
      requestAnimationFrame(() => {
        measure();
        requestAnimationFrame(measure);
      });
      startLoop();
    } else if (trigger === "external" && active) {
      measure();
      startLoop();
    }
  });

  onDestroy(() => {
    stopLoop();
    clearExitTimeouts();
  });
</script>

<div
  class="marquee-viewport {containerClass}"
  bind:this={containerEl}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
>
  <div
    class="marquee-scale"
    class:is-scaling={exitPhase === "recede" || exitPhase === "restore"}
    style="transform: scale({scale})"
  >
    <div
      class="marquee-track {contentClass}"
      class:is-returning={exitPhase === "return"}
      style="transform: translateX(-{offset}px)"
    >
      <div class="marquee-copy" bind:this={copyEl}>
        <slot />
      </div>
      {#if overflowing}
        <div class="marquee-gap" style="width: {gap}px"></div>
        <div class="marquee-copy" aria-hidden="true" inert>
          <slot />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .marquee-viewport {
    overflow: hidden;
    min-width: 0;
    max-width: 100%;
  }

  .marquee-scale {
    transform-origin: center;
  }

  .marquee-scale.is-scaling {
    transition: transform 200ms ease-out;
  }

  .marquee-track {
    display: inline-flex;
    align-items: baseline;
    width: max-content;
    white-space: nowrap;
  }

  .marquee-track.is-returning {
    transition: transform 320ms cubic-bezier(0.65, 0, 0.35, 1);
  }

  .marquee-copy {
    display: inline-flex;
    align-items: baseline;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .marquee-gap {
    flex-shrink: 0;
  }
</style>