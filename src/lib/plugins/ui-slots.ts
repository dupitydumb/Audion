// UI Slot system for plugins
// Provides formal extension points in the UI

export type UISlotName = 'playerbar:left' | 'playerbar:right' | 'sidebar:top' | 'sidebar:bottom' | 'playerbar:menu' | 'mobile:home' | 'mobile:bottomnav';

export interface UISlotContent {
    pluginName: string;
    element: HTMLElement;
    priority: number; // Lower numbers = higher priority (appear first)
}

export class UISlotManager {
    private slots: Map<UISlotName, UISlotContent[]> = new Map();
    private containers: Map<UISlotName, HTMLElement> = new Map();
    private layoutUnsubscribers: Map<UISlotName, () => void> = new Map();

    /**
     * Register a slot container element in the DOM
     */
    registerContainer(slotName: UISlotName, container: HTMLElement): void {
        this.containers.set(slotName, container);

        // Ensure shadow root exists for the container
        if (!container.shadowRoot) {
            container.attachShadow({ mode: 'open' });

            // Inject a style tag to forward CSS variables
            this.injectSharedStyles(container.shadowRoot!);
        }

        // shadow DOM styles can't see ancestor classes (like html.layout-mobile)
        // across the shadow boundary, so mirror the resolved layout mode onto
        // the host element itself via a class, kept in sync with the same
        // override-aware store the rest of the app uses
        this.layoutUnsubscribers.get(slotName)?.();
        import('$lib/stores/mobile').then(({ isMobile }) => {
            const unsubscribe = isMobile.subscribe(($mobile) => {
                container.classList.toggle('layout-mobile', $mobile);
                container.classList.toggle('layout-desktop', !$mobile);
            });
            this.layoutUnsubscribers.set(slotName, unsubscribe);
        });

        // Render any pending content
        this.renderSlot(slotName);
    }

    /**
     * Unregister a slot container
     */
    unregisterContainer(slotName: UISlotName): void {
        this.containers.delete(slotName);
        this.layoutUnsubscribers.get(slotName)?.();
        this.layoutUnsubscribers.delete(slotName);
    }

    /**
     * Slot alias map: content added to a source slot is auto-cloned to target slots.
     * This provides backward compatibility so plugins registering to 'playerbar:menu'
     * automatically appear in 'mobile:home' without any plugin code changes.
     */
    private static readonly SLOT_MIRRORS: Partial<Record<UISlotName, UISlotName[]>> = {
        'playerbar:menu': ['mobile:home'],
    };

    /** Track cloned elements so we can clean them up on removal */
    private mirrorElements: Map<string, { slot: UISlotName; element: HTMLElement }[]> = new Map();

    /**
     * Add plugin content to a slot
     */
    addContent(slotName: UISlotName, content: UISlotContent): void {
        this._addToSlot(slotName, content);

        // Auto-mirror: clone content to aliased mobile slots
        const mirrors = UISlotManager.SLOT_MIRRORS[slotName];
        if (mirrors) {
            const key = `${slotName}::${content.pluginName}`;
            // Remove old mirrors first
            this._removeMirrors(key);
            const entries: { slot: UISlotName; element: HTMLElement }[] = [];

            for (const targetSlot of mirrors) {
                const clonedElement = content.element.cloneNode(true) as HTMLElement;
                // Copy event listeners by re-dispatching click to original
                clonedElement.addEventListener('click', () => {
                    content.element.click();
                });
                const mirrorContent: UISlotContent = {
                    pluginName: content.pluginName,
                    element: clonedElement,
                    priority: content.priority,
                };
                this._addToSlot(targetSlot, mirrorContent);
                entries.push({ slot: targetSlot, element: clonedElement });
            }
            this.mirrorElements.set(key, entries);
        }
    }

    /** Internal: add content to a single slot without triggering mirrors */
    private _addToSlot(slotName: UISlotName, content: UISlotContent): void {
        if (!this.slots.has(slotName)) {
            this.slots.set(slotName, []);
        }

        const slotContents = this.slots.get(slotName)!;

        // Check if plugin already has content in this slot
        const existingIndex = slotContents.findIndex(c => c.pluginName === content.pluginName);
        if (existingIndex >= 0) {
            slotContents[existingIndex] = content;
        } else {
            slotContents.push(content);
        }

        slotContents.sort((a, b) => a.priority - b.priority);
        this.renderSlot(slotName);
    }

    /** Remove cloned mirror elements for a given key */
    private _removeMirrors(key: string): void {
        const entries = this.mirrorElements.get(key);
        if (!entries) return;
        for (const { slot, element } of entries) {
            const contents = this.slots.get(slot);
            if (contents) {
                const filtered = contents.filter(c => c.element !== element);
                this.slots.set(slot, filtered);
                this.renderSlot(slot);
            }
        }
        this.mirrorElements.delete(key);
    }

    /**
     * Remove plugin content from a slot
     */
    removeContent(slotName: UISlotName, pluginName: string): void {
        const slotContents = this.slots.get(slotName);
        if (!slotContents) return;

        const filtered = slotContents.filter(c => c.pluginName !== pluginName);
        this.slots.set(slotName, filtered);
        this.renderSlot(slotName);

        // Also remove mirrors
        const key = `${slotName}::${pluginName}`;
        this._removeMirrors(key);
    }

    /**
     * Remove all content from a plugin across all slots
     */
    removePluginContent(pluginName: string): void {
        this.slots.forEach((contents, slotName) => {
            const filtered = contents.filter(c => c.pluginName !== pluginName);
            this.slots.set(slotName, filtered);
            this.renderSlot(slotName);
        });
        // Clean up all mirrors for this plugin
        for (const [key] of this.mirrorElements) {
            if (key.endsWith(`::${pluginName}`)) {
                this._removeMirrors(key);
            }
        }
    }

    /**
     * Render a slot's content into its container
     */
    private renderSlot(slotName: UISlotName): void {
        const container = this.containers.get(slotName);
        if (!container || !container.shadowRoot) return;

        const contents = this.slots.get(slotName) || [];

        // Clear existing content in shadow root
        // We keep the style tag (first child)
        while (container.shadowRoot.childNodes.length > 1) {
            container.shadowRoot.removeChild(container.shadowRoot.lastChild!);
        }

        // Add all content elements
        contents.forEach(content => {
            container.shadowRoot!.appendChild(content.element);
        });
    }

    /**
     * Inject shared styles into shadow root (themes, variables)
     */
    private injectSharedStyles(shadow: ShadowRoot): void {
        const style = document.createElement('style');
        style.id = 'audion-shared-styles';

        // Forward essential CSS variables for plugins to follow theme
        style.textContent = `
            :host {
                display: flex;
                flex-direction: column;
                gap: 2px;
                --text-primary: var(--text-primary);
                --text-secondary: var(--text-secondary);
                --text-subdued: var(--text-subdued);
                --bg-primary: var(--bg-primary);
                --bg-surface: var(--bg-surface);
                --bg-highlight: var(--bg-highlight);
                --accent-color: var(--accent-color);
                --border-color: var(--border-color);
                --radius-sm: var(--radius-sm);
                --radius-md: var(--radius-md);
                --spacing-sm: var(--spacing-sm);
                --spacing-xs: var(--spacing-xs);
                --transition-fast: var(--transition-fast);
            }
            
            /* Target direct children - premium menu item layout */
            :host > *:not(style) {
                width: 100%;
                box-sizing: border-box;
                text-align: left;
                padding: 10px 12px;
                border-radius: var(--radius-sm);
                background: transparent;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 0.875rem;
                font-weight: 500;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: inherit;
                text-decoration: none;
                line-height: 1.2;
                transform: translateX(0);
            }

            :host > *:not(style):hover {
                background-color: var(--bg-highlight);
                color: var(--text-primary);
                transform: translateX(4px);
            }

            /* Sleek, constrained icons */
            svg, img, i {
                width: 16px !important;
                height: 16px !important;
                min-width: 16px !important;
                min-height: 16px !important;
                flex-shrink: 0;
                display: block;
                object-fit: contain;
                opacity: 0.8;
                transition: opacity var(--transition-fast);
            }

            :host > *:not(style):hover svg,
            :host > *:not(style):hover img {
                opacity: 1;
            }

            /* Reset for images */
            img {
                border-radius: 2px;
            }

            /* Mobile: larger touch targets */
            :host(.layout-mobile) > *:not(style) {
                padding: 14px 12px;
                min-height: 44px;
                -webkit-tap-highlight-color: transparent;
            }

            :host(.layout-mobile) > *:not(style):hover {
                transform: none;
            }

            :host(.layout-mobile) > *:not(style):active {
                background-color: var(--bg-highlight);
                color: var(--text-primary);
            }
        `;

        shadow.appendChild(style);
    }

    /**
     * Get all content for a slot
     */
    getSlotContent(slotName: UISlotName): UISlotContent[] {
        return this.slots.get(slotName) || [];
    }

    /**
     * Get container element for a slot
     */
    getContainer(slotName: UISlotName): HTMLElement | undefined {
        return this.containers.get(slotName);
    }

    /**
 * Get all slot names that have content
 */
    getAllSlots(): UISlotName[] {
        return Array.from(this.slots.keys());
    }

    /**
     * Clear all slots and containers (for complete cleanup)
     */
    clearAll(): void {
        this.slots.clear();
        this.containers.forEach(container => {
            container.innerHTML = '';
        });
    }
}

// Global singleton
export const uiSlotManager = new UISlotManager();
