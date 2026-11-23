/**
 * gestureGuard.ts
 *
 * Svelte action to prevent nested scroll collisions between internal scroll views
 * (such as lyrics lists, queue panels, or nested modal sheets) and parent bottom-sheet
 * drag-to-dismiss gestures.
 *
 * Inspects touch movements past an initial touch-slop threshold:
 * 1. If the inner content can scroll in the requested direction, the gesture is locked
 *    to the inner view and event propagation to parent drag handlers is stopped.
 * 2. If the inner content is at its boundary (e.g. scrollTop === 0 and user pulls downwards),
 *    the action can either allow the gesture to bubble up for sheet dismissal (bubbleAtEdges = true)
 *    or strictly contain all gestures within the container (bubbleAtEdges = false).
 */

export interface GestureGuardOptions {
  /**
   * Primary direction to guard.
   * Default: 'vertical'
   */
  direction?: 'vertical' | 'horizontal' | 'both';

  /**
   * Touch slop threshold in pixels before locking gesture intent.
   * Default: 6
   */
  threshold?: number;

  /**
   * If true, allows touch events to bubble to parent bottom sheets
   * ONLY when the scroll view has reached its edge and cannot scroll further
   * (e.g. at scrollTop === 0 and pulling down to dismiss sheet).
   * Default: true
   */
  bubbleAtEdges?: boolean;

  /**
   * Lock gestures strictly to the first determined axis.
   * Default: true
   */
  axisLock?: boolean;

  /**
   * Whether to call stopPropagation() on locked gestures.
   * Default: true
   */
  stopPropagation?: boolean;

  /**
   * Optional callback when an internal scroll gesture is locked.
   */
  onLock?: (direction: 'up' | 'down' | 'left' | 'right') => void;

  /**
   * Optional callback when gesture completes.
   */
  onRelease?: () => void;
}

/**
 * Checks whether an event has been intercepted and guarded by gestureGuard.
 */
export function isGestureGuarded(event: Event): boolean {
  return Boolean((event as unknown as { __gestureGuarded?: boolean }).__gestureGuarded);
}

/**
 * Svelte action for nested scrollable elements.
 */
export function gestureGuard(
  node: HTMLElement,
  initialOptions: GestureGuardOptions = {}
) {
  let opts: GestureGuardOptions = {
    direction: 'vertical',
    threshold: 6,
    bubbleAtEdges: true,
    axisLock: true,
    stopPropagation: true,
    ...initialOptions,
  };

  let startX = 0;
  let startY = 0;
  let isTracking = false;
  let isLocked = false;
  let lockedDirection: 'up' | 'down' | 'left' | 'right' | null = null;

  function canScrollVertically(deltaY: number): boolean {
    const { scrollTop, scrollHeight, clientHeight } = node;
    const maxScroll = scrollHeight - clientHeight;

    if (maxScroll <= 0) {
      // Content does not overflow vertically
      return false;
    }

    if (deltaY > 0) {
      // Finger moving down => scrolling view upwards
      return scrollTop > 1;
    } else {
      // Finger moving up => scrolling view downwards
      return scrollTop < maxScroll - 1;
    }
  }

  function canScrollHorizontally(deltaX: number): boolean {
    const { scrollLeft, scrollWidth, clientWidth } = node;
    const maxScroll = scrollWidth - clientWidth;

    if (maxScroll <= 0) {
      return false;
    }

    if (deltaX > 0) {
      return scrollLeft > 1;
    } else {
      return scrollLeft < maxScroll - 1;
    }
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isTracking = true;
    isLocked = false;
    lockedDirection = null;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isTracking || e.touches.length !== 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (!isLocked) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const dist = Math.hypot(dx, dy);

      if (dist < (opts.threshold ?? 6)) {
        return;
      }

      const isVertical = absDy >= absDx;
      const targetDir = opts.direction ?? 'vertical';

      if (targetDir === 'vertical' || targetDir === 'both') {
        if (isVertical) {
          const canScroll = canScrollVertically(dy);
          if (canScroll || !opts.bubbleAtEdges) {
            isLocked = true;
            lockedDirection = dy > 0 ? 'down' : 'up';
            opts.onLock?.(lockedDirection);
          }
        }
      }

      if (!isLocked && (targetDir === 'horizontal' || targetDir === 'both')) {
        if (!isVertical) {
          const canScroll = canScrollHorizontally(dx);
          if (canScroll || !opts.bubbleAtEdges) {
            isLocked = true;
            lockedDirection = dx > 0 ? 'right' : 'left';
            opts.onLock?.(lockedDirection);
          }
        }
      }
    }

    if (isLocked) {
      (e as unknown as { __gestureGuarded: boolean }).__gestureGuarded = true;
      if (opts.stopPropagation) {
        e.stopPropagation();
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (isLocked) {
      (e as unknown as { __gestureGuarded: boolean }).__gestureGuarded = true;
      if (opts.stopPropagation) {
        e.stopPropagation();
      }
      opts.onRelease?.();
    }
    isTracking = false;
    isLocked = false;
    lockedDirection = null;
  }

  // Pointer events fallback for desktop/hybrid touch pointers
  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    startX = e.clientX;
    startY = e.clientY;
    isTracking = true;
    isLocked = false;
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isTracking || e.pointerType !== 'touch') return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!isLocked) {
      const dist = Math.hypot(dx, dy);
      if (dist < (opts.threshold ?? 6)) return;

      const isVertical = Math.abs(dy) >= Math.abs(dx);
      if ((opts.direction === 'vertical' || opts.direction === 'both') && isVertical) {
        if (canScrollVertically(dy) || !opts.bubbleAtEdges) {
          isLocked = true;
          lockedDirection = dy > 0 ? 'down' : 'up';
        }
      }
    }

    if (isLocked) {
      (e as unknown as { __gestureGuarded: boolean }).__gestureGuarded = true;
      if (opts.stopPropagation) {
        e.stopPropagation();
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    if (isLocked && opts.stopPropagation) {
      e.stopPropagation();
      opts.onRelease?.();
    }
    isTracking = false;
    isLocked = false;
  }

  node.addEventListener('touchstart', handleTouchStart, { passive: true });
  node.addEventListener('touchmove', handleTouchMove, { passive: false });
  node.addEventListener('touchend', handleTouchEnd, { passive: false });
  node.addEventListener('touchcancel', handleTouchEnd, { passive: false });

  node.addEventListener('pointerdown', handlePointerDown, { passive: true });
  node.addEventListener('pointermove', handlePointerMove, { passive: false });
  node.addEventListener('pointerup', handlePointerUp, { passive: false });
  node.addEventListener('pointercancel', handlePointerUp, { passive: false });

  return {
    update(newOptions: GestureGuardOptions) {
      opts = {
        ...opts,
        ...newOptions,
      };
    },
    destroy() {
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('touchend', handleTouchEnd);
      node.removeEventListener('touchcancel', handleTouchEnd);

      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerup', handlePointerUp);
      node.removeEventListener('pointercancel', handlePointerUp);
    },
  };
}

export default gestureGuard;
