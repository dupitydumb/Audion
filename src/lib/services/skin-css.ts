/**
 * skin-css.ts
 *
 * Manages runtime custom CSS injection for Audion skins.
 * Injects and updates <style id="audion-skin-css"> in document.head.
 */

const STYLE_ELEMENT_ID = 'audion-skin-css';

function getStyleElement(): HTMLStyleElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
}

function ensureStyleElement(): HTMLStyleElement | null {
    if (typeof document === 'undefined') return null;
    let el = getStyleElement();
    if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ELEMENT_ID;
        el.setAttribute('type', 'text/css');
        document.head.appendChild(el);
    }
    return el;
}

/**
 * Apply or update the skin custom CSS stylesheet.
 * If css is empty or undefined, clears the stylesheet content.
 */
export function applySkinCss(css: string | undefined): void {
    if (typeof document === 'undefined') return;

    const trimmed = (css || '').trim();
    const styleEl = ensureStyleElement();
    if (!styleEl) return;

    if (!trimmed) {
        styleEl.textContent = '';
        return;
    }

    styleEl.textContent = trimmed;
}

/**
 * Completely remove the injected skin stylesheet content.
 */
export function clearSkinCss(): void {
    if (typeof document === 'undefined') return;
    const el = getStyleElement();
    if (el) {
        el.textContent = '';
    }
}

