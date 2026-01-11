<script lang="ts">
    import { theme, presetAccents, type ThemeMode } from "$lib/stores/theme";
    import { appSettings } from "$lib/stores/settings";
    import { open } from "@tauri-apps/plugin-dialog";

    let customColorInput = "#1DB954";
    let downloadPath = "";

    // Sync download path from store
    $: downloadPath = $appSettings.downloadLocation || "";

    function handleModeChange(mode: ThemeMode) {
        theme.setMode(mode);
    }

    function handleAccentChange(color: string) {
        theme.setAccentColor(color);
    }

    function handleCustomColorAdd() {
        if (customColorInput && /^#[0-9A-Fa-f]{6}$/.test(customColorInput)) {
            theme.addCustomColor(customColorInput);
            theme.setAccentColor(customColorInput);
        }
    }

    async function browseDownloadLocation() {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Select Download Folder",
            });
            if (selected) {
                downloadPath = selected;
                appSettings.setDownloadLocation(selected);
            }
        } catch (err) {
            console.error("[Settings] Failed to open folder picker:", err);
        }
    }

    function handleDownloadPathChange() {
        appSettings.setDownloadLocation(downloadPath || null);
    }

    function clearDownloadPath() {
        downloadPath = "";
        appSettings.setDownloadLocation(null);
    }
</script>

<div class="settings-view">
    <header class="view-header">
        <h1>Settings</h1>
    </header>

    <div class="settings-content">
        <!-- Theme Mode -->
        <section class="settings-section">
            <h3 class="section-title">Appearance</h3>

            <div class="setting-item">
                <span class="setting-label">Theme Mode</span>
                <div class="theme-modes">
                    <button
                        class="mode-btn"
                        class:active={$theme.mode === "dark"}
                        on:click={() => handleModeChange("dark")}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill="currentColor"
                        >
                            <path
                                d="M9.37 5.51c-.18.64-.27 1.31-.27 1.99 0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27C17.45 17.19 14.93 19 12 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49zM12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"
                            />
                        </svg>
                        <span>Dark</span>
                    </button>
                    <button
                        class="mode-btn"
                        class:active={$theme.mode === "light"}
                        on:click={() => handleModeChange("light")}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill="currentColor"
                        >
                            <path
                                d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"
                            />
                        </svg>
                        <span>Light</span>
                    </button>
                    <button
                        class="mode-btn"
                        class:active={$theme.mode === "system"}
                        on:click={() => handleModeChange("system")}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill="currentColor"
                        >
                            <path
                                d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"
                            />
                        </svg>
                        <span>System</span>
                    </button>
                </div>
            </div>
        </section>

        <!-- Accent Color -->
        <section class="settings-section">
            <h3 class="section-title">Accent Color</h3>

            <div class="setting-item">
                <div class="color-grid">
                    {#each presetAccents as preset}
                        <button
                            class="color-swatch"
                            class:active={$theme.accentColor === preset.color}
                            style="--swatch-color: {preset.color}"
                            on:click={() => handleAccentChange(preset.color)}
                            title={preset.name}
                        >
                            {#if $theme.accentColor === preset.color}
                                <svg
                                    viewBox="0 0 24 24"
                                    width="16"
                                    height="16"
                                    fill="currentColor"
                                >
                                    <path
                                        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                    />
                                </svg>
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Custom Colors -->
            {#if $theme.customAccentColors.length > 0}
                <div class="setting-item">
                    <span class="setting-label">Custom Colors</span>
                    <div class="color-grid small">
                        {#each $theme.customAccentColors as color}
                            <button
                                class="color-swatch small"
                                class:active={$theme.accentColor === color}
                                style="--swatch-color: {color}"
                                on:click={() => handleAccentChange(color)}
                            >
                                {#if $theme.accentColor === color}
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="12"
                                        height="12"
                                        fill="currentColor"
                                    >
                                        <path
                                            d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                        />
                                    </svg>
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Add Custom Color -->
            <div class="setting-item">
                <span class="setting-label">Add Custom Color</span>
                <div class="custom-color-input">
                    <input
                        type="color"
                        bind:value={customColorInput}
                        class="color-picker"
                    />
                    <input
                        type="text"
                        bind:value={customColorInput}
                        placeholder="#1DB954"
                        class="color-text"
                        maxlength="7"
                    />
                    <button class="add-btn" on:click={handleCustomColorAdd}>
                        Add
                    </button>
                </div>
            </div>
        </section>

        <!-- General -->
        <section class="settings-section">
            <h3 class="section-title">General</h3>

            <div class="setting-item">
                <div class="toggle-container">
                    <div class="toggle-info">
                        <span class="setting-label">Show Discord Button</span>
                        <p class="setting-hint">
                            Show a link to the community Discord in the sidebar
                        </p>
                    </div>
                    <button
                        class="toggle-btn"
                        class:active={$appSettings.showDiscord}
                        on:click={() =>
                            appSettings.setShowDiscord(
                                !$appSettings.showDiscord,
                            )}
                        aria-label="Toggle Discord Button"
                    >
                        <div class="toggle-handle"></div>
                    </button>
                </div>
            </div>
        </section>

        <!-- Developer -->
        <section class="settings-section">
            <h3 class="section-title">Developer</h3>

            <div class="setting-item">
                <div class="toggle-container">
                    <div class="toggle-info">
                        <span class="setting-label">Developer Mode</span>
                        <p class="setting-hint">
                            Enable browser right-click menu and inspection tools
                        </p>
                    </div>
                    <button
                        class="toggle-btn"
                        class:active={$appSettings.developerMode}
                        on:click={() =>
                            appSettings.setDeveloperMode(
                                !$appSettings.developerMode,
                            )}
                        aria-label="Toggle Developer Mode"
                    >
                        <div class="toggle-handle"></div>
                    </button>
                </div>
            </div>
        </section>

        <!-- About -->
        <section class="settings-section">
            <h3 class="section-title">About</h3>
            <div class="about-info">
                <div class="app-logo">
                    <svg
                        viewBox="0 0 48 48"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="4"
                        width="32"
                        height="32"
                    >
                        <path d="M5 42H10"></path><path d="M5 36H10"
                        ></path><path d="M5 30H10"></path><path d="M5 24H10"
                        ></path><path d="M16 42H21"></path><path d="M16 36H21"
                        ></path><path d="M16 30H21"></path><path d="M16 24H21"
                        ></path><path d="M16 18H21"></path><path d="M16 12H21"
                        ></path><path d="M16 6H21"></path><path d="M27 42H32"
                        ></path><path d="M38 42H43"></path><path d="M27 36H32"
                        ></path><path d="M38 36H43"></path><path d="M27 30H32"
                        ></path><path d="M38 30H43"></path><path d="M38 24H43"
                        ></path><path d="M38 18H43"></path>
                    </svg>
                    <span>Audion</span>
                </div>
                <p class="version">Version 1.0.0</p>
                <p class="copyright">
                    A modern music player built with Tauri & Svelte
                </p>
            </div>
        </section>
    </div>
</div>

<style>
    .settings-view {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .view-header {
        padding: var(--spacing-lg) var(--spacing-md);
        flex-shrink: 0;
    }

    .view-header h1 {
        font-size: 2rem;
        font-weight: 700;
    }

    .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
        padding-bottom: calc(var(--player-height) + var(--spacing-lg));
    }

    .settings-section {
        margin-bottom: var(--spacing-xl);
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-lg);
    }

    .section-title {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-subdued);
        margin-bottom: var(--spacing-md);
        padding-bottom: var(--spacing-sm);
        border-bottom: 1px solid var(--border-color);
    }

    .setting-item {
        margin-bottom: var(--spacing-md);
    }

    .setting-label {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
        display: block;
    }

    /* Theme Mode Buttons */
    .theme-modes {
        display: flex;
        gap: var(--spacing-md);
    }

    .mode-btn {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-lg);
        background-color: var(--bg-surface);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
        border: 2px solid transparent;
    }

    .mode-btn:hover {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .mode-btn.active {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
        background-color: rgba(var(--accent-rgb), 0.1);
    }

    .mode-btn span {
        font-size: 0.875rem;
        font-weight: 500;
    }

    /* Color Grid */
    .color-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
        gap: var(--spacing-sm);
    }

    .color-swatch {
        aspect-ratio: 1;
        border-radius: var(--radius-md);
        background-color: var(--swatch-color);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all var(--transition-fast);
        border: 2px solid transparent;
        width: 100%;
        max-width: 48px;
    }

    .color-swatch:hover {
        transform: scale(1.1);
    }

    .color-swatch.active {
        border-color: var(--text-primary);
        box-shadow: 0 0 0 2px var(--bg-base);
    }

    .color-swatch.small {
        border-radius: var(--radius-sm);
    }

    .color-swatch svg {
        color: white;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    /* Custom Color Input */
    .custom-color-input {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
    }

    .color-picker {
        width: 40px;
        height: 40px;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        padding: 0;
    }

    .color-picker::-webkit-color-swatch-wrapper {
        padding: 0;
    }

    .color-picker::-webkit-color-swatch {
        border: none;
        border-radius: var(--radius-sm);
    }

    .color-text {
        flex: 1;
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-family: monospace;
        max-width: 120px;
    }

    .color-text:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .add-btn {
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--accent-primary);
        color: var(--bg-base);
        font-weight: 600;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }

    .add-btn:hover {
        background-color: var(--accent-hover);
    }

    /* Path Input */
    .path-input-container {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
    }

    .path-input {
        flex: 1;
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 0.875rem;
    }

    .path-input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .path-input::placeholder {
        color: var(--text-subdued);
    }

    .browse-btn {
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-surface);
        color: var(--text-primary);
        font-weight: 500;
        font-size: 0.875rem;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
        white-space: nowrap;
        border: 1px solid var(--border-color);
    }

    .browse-btn:hover {
        background-color: var(--bg-highlight);
        border-color: var(--text-primary);
    }

    .clear-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: transparent;
        color: var(--text-subdued);
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }

    .clear-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .setting-hint {
        font-size: 0.8125rem;
        color: var(--text-subdued);
        margin-top: var(--spacing-xs);
    }

    /* About */
    .about-info {
        text-align: center;
        padding: var(--spacing-lg);
        background-color: var(--bg-surface);
        border-radius: var(--radius-md);
        margin-top: var(--spacing-sm);
    }

    .app-logo {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        color: var(--accent-primary);
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: var(--spacing-sm);
    }

    .version {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-xs);
    }

    .copyright {
        font-size: 0.75rem;
        color: var(--text-subdued);
    }

    /* Toggle Switch */
    .toggle-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .toggle-btn {
        width: 48px;
        height: 26px;
        background-color: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: 13px;
        position: relative;
        cursor: pointer;
        transition: all var(--transition-fast);
        padding: 0;
    }

    .toggle-btn.active {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
    }

    .toggle-handle {
        width: 20px;
        height: 20px;
        background-color: var(--text-subdued);
        border-radius: 50%;
        position: absolute;
        top: 2px;
        left: 2px;
        transition:
            transform var(--transition-fast),
            background-color var(--transition-fast);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .toggle-btn.active .toggle-handle {
        transform: translateX(22px);
        background-color: white;
    }
</style>
