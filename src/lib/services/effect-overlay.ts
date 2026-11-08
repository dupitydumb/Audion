/**
 * effect-overlay.ts
 *
 * Runs a theme's customJs effect on the #audion-effect-layer canvas.
 *
 * The user script receives:
 *   canvas   – the HTMLCanvasElement (full-viewport, pointer-events:none)
 *   ctx      – its 2D context
 *   accent   – current accent color hex string
 *
 * It must return a cleanup function () => void that cancels any rAF loops,
 * removes event listeners, etc.  If it returns nothing the overlay just clears.
 *
 * The script runs only when ThemeState.allowCustomJs === true.
 */

let _cleanup: (() => void) | null = null;
let _pendingEffect: { js: string; accent: string } | null = null;
let _retryRaf: number | null = null;

function getCanvas(): HTMLCanvasElement | null {
    return document.getElementById('audion-effect-layer') as HTMLCanvasElement | null;
}

function clearCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** Stop the running effect (if any) and clear the canvas. */
export function stopEffect(): void {
    if (_retryRaf) {
        cancelAnimationFrame(_retryRaf);
        _retryRaf = null;
    }
    if (_cleanup) {
        try { _cleanup(); } catch { /* ignore */ }
        _cleanup = null;
    }
    const canvas = getCanvas();
    if (canvas) {
        canvas.style.display = 'none';
        clearCanvas(canvas);
    }
}

/**
 * Start a custom-JS effect.
 * @param js        The user script string from the .audiotheme file.
 * @param accent    Current accent color (e.g. '#60a5fa').
 */
export function startEffect(js: string, accent: string): void {
    if (_cleanup) {
        try { _cleanup(); } catch { /* ignore */ }
        _cleanup = null;
    }

    const canvas = getCanvas();
    if (!canvas) {
        // Canvas not yet in DOM; retry on next animation frame
        if (typeof window !== 'undefined' && !_retryRaf) {
            _retryRaf = requestAnimationFrame(() => {
                _retryRaf = null;
                if (_pendingEffect) {
                    startEffect(_pendingEffect.js, _pendingEffect.accent);
                }
            });
        }
        return;
    }

    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;

    if (width === 0 || height === 0) {
        // Window dimensions not ready yet; retry on next animation frame
        if (typeof window !== 'undefined' && !_retryRaf) {
            _retryRaf = requestAnimationFrame(() => {
                _retryRaf = null;
                if (_pendingEffect) {
                    startEffect(_pendingEffect.js, _pendingEffect.accent);
                }
            });
        }
        return;
    }

    if (_retryRaf) {
        cancelAnimationFrame(_retryRaf);
        _retryRaf = null;
    }

    // Fit canvas to viewport
    canvas.width  = width;
    canvas.height = height;
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let resizeHandle: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    try {
        // Wrap in a function that receives (canvas, ctx, accent) and returns cleanup.
        // New Function is intentional — this is a user-authored creative script,
        // gated behind the allowCustomJs toggle the user explicitly enables.
        // ponytail: no iframe sandbox; upgrade to sandboxed worker when needed.
        const factory = new Function('canvas', 'ctx', 'accent', js) as
            (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, accent: string) => (() => void) | undefined;

        const userCleanup = factory(canvas, ctx, accent);

        // Auto-resize canvas on window resize and re-invoke with debounce
        resizeHandle = () => {
            const newW = window.innerWidth || document.documentElement.clientWidth || 0;
            const newH = window.innerHeight || document.documentElement.clientHeight || 0;
            if (newW > 0 && newH > 0) {
                canvas.width = newW;
                canvas.height = newH;
            }
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (_pendingEffect && _pendingEffect.js === js) {
                    startEffect(js, accent);
                }
            }, 250);
        };
        window.addEventListener('resize', resizeHandle, { passive: true });

        _cleanup = () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            if (resizeHandle) window.removeEventListener('resize', resizeHandle);
            if (typeof userCleanup === 'function') userCleanup();
        };
    } catch (e) {
        console.error('[EffectOverlay] Error in custom effect script:', e);
        if (resizeTimer) clearTimeout(resizeTimer);
        if (resizeHandle) window.removeEventListener('resize', resizeHandle);
        canvas.style.display = 'none';
    }
}

/**
 * Called by applyTheme. Starts or stops the effect based on state.
 */
export function applyEffect(customJs: string | undefined, accent: string, allowCustomJs: boolean): void {
    if (!allowCustomJs || !customJs?.trim()) {
        _pendingEffect = null;
        if (_retryRaf) {
            cancelAnimationFrame(_retryRaf);
            _retryRaf = null;
        }
        stopEffect();
        return;
    }
    _pendingEffect = { js: customJs, accent };
    startEffect(customJs, accent);
}
