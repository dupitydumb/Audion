import { get } from "svelte/store";
import { isMobile, isTV } from "$lib/stores/mobile";

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "[role='button']:not([aria-disabled='true']):not([tabindex='-1'])",
  "a[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[role='slider']:not([aria-disabled='true'])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function isVisibleFocusable(el: HTMLElement): boolean {
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getScopeRoot(): HTMLElement {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>("[role='dialog'], .mobile-menu-sheet")
  ).filter(isVisibleFocusable);
  if (dialogs.length > 0) {
    return dialogs[dialogs.length - 1];
  }
  return document.body;
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.getAttribute("role") === "slider") return true;
  return false;
}

function findNextFocusable(
  current: HTMLElement | null,
  direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  root: HTMLElement
): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => el !== current && isVisibleFocusable(el));

  if (candidates.length === 0) return null;
  if (!current || !root.contains(current)) {
    return candidates[0];
  }

  const origin = current.getBoundingClientRect();
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - ox;
    const dy = cy - oy;

    let primary = 0;
    let secondary = 0;

    if (direction === "ArrowRight") {
      if (dx <= 4) continue;
      primary = dx;
      secondary = Math.abs(dy);
    } else if (direction === "ArrowLeft") {
      if (dx >= -4) continue;
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (direction === "ArrowDown") {
      if (dy <= 4) continue;
      primary = dy;
      secondary = Math.abs(dx);
    } else {
      if (dy >= -4) continue;
      primary = -dy;
      secondary = Math.abs(dx);
    }

    // Weight perpendicular offset higher so D-Pad prefers aligned rows/columns
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

/**
 * Installs geometric D-Pad spatial focus navigation for Smart TV / remote devices.
 * Returns a cleanup function.
 */
export function initDpadNavigation(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleKeydown = (e: KeyboardEvent) => {
    if (!ARROW_KEYS.has(e.key)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (!get(isTV) && !get(isMobile)) return;
    if (e.defaultPrevented || shouldIgnoreTarget(e.target)) return;

    const root = getScopeRoot();
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = findNextFocusable(
      active,
      e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
      root
    );

    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  };

  window.addEventListener("keydown", handleKeydown);
  return () => window.removeEventListener("keydown", handleKeydown);
}
