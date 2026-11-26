import { get } from "svelte/store";
import { fade, fly, scale, type TransitionConfig } from "svelte/transition";
import { backOut, cubicOut } from "svelte/easing";
import { isMobile, appleSpring } from "$lib/stores/mobile";

export const MOTION_DURATION = {
  instant: 100,
  fast: 150,
  exit: 150,
  normal: 220,
  enter: 240,
  sheetEnter: 320,
  sheetExit: 220,
} as const;

export function isReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const NO_MOTION: TransitionConfig = { duration: 0 };

/** Backdrop fade shared by all modals, dialogs, and sheets. */
export function modalBackdropTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fade(node, { duration: MOTION_DURATION.fast, easing: cubicOut });
}

/** Centered dialog/modal scale entrance & exit (desktop & mobile dialogs). */
export function modalBoxTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return scale(node, {
    start: 0.95,
    opacity: 0,
    duration: MOTION_DURATION.normal,
    easing: appleSpring,
  });
}

/** Responsive modal: bottom sheet on mobile, centered spring scale on desktop. */
export function responsiveModalTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  if (get(isMobile)) {
    return fly(node, {
      y: 320,
      duration: MOTION_DURATION.sheetEnter,
      opacity: 1,
      easing: appleSpring,
    });
  }
  return modalBoxTransition(node);
}

/** Mobile bottom-sheet enter/exit (ContextMenu mobile, FullScreenMobileBottomSheet). */
export function sheetInTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fly(node, {
    y: 320,
    duration: MOTION_DURATION.sheetEnter,
    opacity: 1,
    easing: appleSpring,
  });
}

export function sheetOutTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fly(node, {
    y: 320,
    duration: MOTION_DURATION.sheetExit,
    opacity: 1,
    easing: cubicOut,
  });
}

/** Popover / dropdown / context-menu entrance & exit. */
export function popoverInTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return scale(node, {
    start: 0.94,
    opacity: 0,
    duration: MOTION_DURATION.fast,
    easing: appleSpring,
  });
}

export function popoverOutTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fade(node, {
    duration: MOTION_DURATION.instant,
    easing: cubicOut,
  });
}

/** Nested submenu slide-in & fade-out. */
export function submenuInTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fly(node, {
    x: -6,
    duration: MOTION_DURATION.fast,
    opacity: 0,
    easing: cubicOut,
  });
}

export function submenuOutTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fade(node, { duration: MOTION_DURATION.instant });
}

/** State-change icon pop (shuffle, repeat, clear-search). */
export function iconPopTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return scale(node, {
    start: 0.72,
    opacity: 0,
    duration: MOTION_DURATION.fast,
    easing: backOut,
  });
}

/** Album art crossfade in/out. */
export function artCrossfadeIn(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fade(node, {
    duration: 180,
    easing: cubicOut,
  });
}

export function artCrossfadeOut(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fade(node, { duration: MOTION_DURATION.exit });
}

/** Toast entrance & exit. */
export function toastInTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fly(node, {
    y: 24,
    duration: MOTION_DURATION.enter,
    opacity: 0,
    easing: cubicOut,
  });
}

export function toastOutTransition(node: Element): TransitionConfig {
  if (isReducedMotion()) return NO_MOTION;
  return fade(node, { duration: MOTION_DURATION.exit });
}

/** Shared flip parameters for list/toast reordering. */
export const FLIP_MOTION = {
  duration: 200,
  easing: cubicOut,
} as const;
