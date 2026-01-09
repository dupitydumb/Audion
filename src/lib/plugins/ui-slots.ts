// UI Slot system for plugins
// Provides formal extension points in the UI

export type UISlotName = 'playerbar:left' | 'playerbar:right' | 'sidebar:top' | 'sidebar:bottom';

export interface UISlotContent {
    pluginName: string;
    element: HTMLElement;
    priority: number; // Lower numbers = higher priority (appear first)
}

export class UISlotManager {
    private slots: Map<UISlotName, UISlotContent[]> = new Map();
    private containers: Map<UISlotName, HTMLElement> = new Map();

    /**
     * Register a slot container element in the DOM
     */
    registerContainer(slotName: UISlotName, container: HTMLElement): void {
        this.containers.set(slotName, container);

        // Render any pending content
        this.renderSlot(slotName);
    }

    /**
     * Unregister a slot container
     */
    unregisterContainer(slotName: UISlotName): void {
        this.containers.delete(slotName);
    }

    /**
     * Add plugin content to a slot
     */
    addContent(slotName: UISlotName, content: UISlotContent): void {
        if (!this.slots.has(slotName)) {
            this.slots.set(slotName, []);
        }

        const slotContents = this.slots.get(slotName)!;

        // Check if plugin already has content in this slot
        const existingIndex = slotContents.findIndex(c => c.pluginName === content.pluginName);
        if (existingIndex >= 0) {
            // Replace existing content
            slotContents[existingIndex] = content;
        } else {
            // Add new content
            slotContents.push(content);
        }

        // Sort by priority
        slotContents.sort((a, b) => a.priority - b.priority);

        // Re-render the slot
        this.renderSlot(slotName);
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
    }

    /**
     * Render a slot's content into its container
     */
    private renderSlot(slotName: UISlotName): void {
        const container = this.containers.get(slotName);
        if (!container) return;

        const contents = this.slots.get(slotName) || [];

        // Clear existing content
        container.innerHTML = '';

        // Add all content elements
        contents.forEach(content => {
            container.appendChild(content.element);
        });
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
}

// Global singleton
export const uiSlotManager = new UISlotManager();
