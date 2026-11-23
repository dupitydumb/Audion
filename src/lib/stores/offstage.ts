import { writable, derived } from 'svelte/store';
import { isFullScreen } from './ui';

/**
 * Manual override for background freeze state.
 * null = auto-follow FullScreenPlayer state.
 */
export const manualBackgroundFrozen = writable<boolean | null>(null);

/**
 * Derived store that evaluates to true whenever FullScreenPlayer is open
 * (or manually frozen). This signals offstage components—such as background
 * audio visualizers, tickers, marquee loops, and offstage canvas renderers—to
 * suspend execution, eliminating unnecessary mobile GPU/CPU draw calls.
 */
export const isBackgroundFrozen = derived(
  [isFullScreen, manualBackgroundFrozen],
  ([$isFullScreen, $manual]) => {
    if ($manual !== null) return $manual;
    return $isFullScreen;
  }
);

/**
 * Manually set the background freeze state (e.g. for modal sheets or tests).
 */
export function setBackgroundFrozen(frozen: boolean): void {
  manualBackgroundFrozen.set(frozen);
}

/**
 * Reset manual freeze override back to tracking isFullScreen.
 */
export function resetBackgroundFrozen(): void {
  manualBackgroundFrozen.set(null);
}

export default isBackgroundFrozen;
