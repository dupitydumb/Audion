<script lang="ts">
  import { _ } from "svelte-i18n";
  import { theme, presetAccents, type ThemeMode, type CustomColors, type BackgroundType, type PageTransition, type VisualizationMode, type TransitionSpeed, exportThemePackage, parseThemePackage } from "$lib/stores/theme";
  import { get } from "svelte/store";
  import { locale } from "svelte-i18n";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import { layoutOverride, type LayoutOverride } from "$lib/stores/mobile";
  import Icon from "$lib/components/Icon.svelte";
  import { isTauri, convertFileSrc } from "$lib/api/tauri";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  function handleModeChange(mode: ThemeMode) {
    theme.setMode(mode);
  }

  function handleLayoutOverrideChange(value: LayoutOverride) {
    layoutOverride.set(value);
  }

  function handleAccentChange(color: string) {
    theme.setAccentColor(color);
  }

  function changeLanguage(lang: string) {
    $locale = lang;
    localStorage.setItem("audion_language", lang);
  }

  let customColorInput = "#1DB954";

  function handleCustomColorAdd() {
    if (customColorInput && /^#[0-9A-Fa-f]{6}$/.test(customColorInput)) {
      theme.addCustomColor(customColorInput);
      theme.setAccentColor(customColorInput);
    }
  }

  // ── Custom color token overrides ────────────────────────────────────────────

  const colorSlots: { key: keyof CustomColors; label: string }[] = [
    { key: "bgBase",       label: "Base background" },
    { key: "bgElevated",   label: "Elevated background" },
    { key: "bgSurface",    label: "Surface / cards" },
    { key: "bgHighlight",  label: "Highlight / hover" },
    { key: "sidebarBg",    label: "Sidebar background" },
    { key: "playerBg",     label: "Player bar background" },
    { key: "textPrimary",  label: "Primary text" },
    { key: "textSecondary",label: "Secondary text" },
    { key: "textSubdued",  label: "Subdued text" },
    { key: "borderColor",  label: "Borders" },
  ];

  // ── Color parsing helpers ────────────────────────────────────────────────────

  /** Extract 6-char hex (#RRGGBB) from a full value that may be 8-char (#RRGGBBAA) */
  function toHex6(val: string): string {
    if (/^#[0-9a-fA-F]{8}$/.test(val)) return val.slice(0, 7);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) return val;
    return '#000000';
  }

  /** Extract 0–1 alpha from an #RRGGBBAA string; 1 if 6-char */
  function toAlpha(val: string): number {
    if (/^#[0-9a-fA-F]{8}$/.test(val)) {
      return parseInt(val.slice(7, 9), 16) / 255;
    }
    return 1;
  }

  /** Combine 6-char hex + 0-1 alpha → 6 or 8-char hex */
  function buildColor(hex6: string, alpha: number): string {
    if (alpha >= 1) return hex6;
    const aa = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return hex6 + aa;
  }

  /** Validate that a string is a valid 6 or 8-char hex */
  function isValidHex(s: string): boolean {
    return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s);
  }

  // Per-slot local state: hex6 + alpha, kept in sync with the store
  let slotHex: Record<string, string> = {};
  let slotAlpha: Record<string, number> = {};
  let slotHexText: Record<string, string> = {};

  // Keep local state in sync when store changes externally (e.g. reset all, import theme).
  // Must reassign the objects (not just mutate) so Svelte propagates changes to the UI.
  $: {
    const h: Record<string, string> = {};
    const a: Record<string, number> = {};
    const t: Record<string, string> = {};
    colorSlots.forEach(({ key }) => {
      const val = $theme.customColors[key];
      if (val === null) {
        h[key] = '#000000';
        a[key] = 1;
        t[key] = '#000000';
      } else {
        h[key] = toHex6(val);
        a[key] = toAlpha(val);
        t[key] = val;
      }
    });
    slotHex = h;
    slotAlpha = a;
    slotHexText = t;
  }

  function onSlotColorPick(key: keyof CustomColors, hex6: string) {
    slotHex[key] = hex6;
    const built = buildColor(hex6, slotAlpha[key]);
    slotHexText[key] = built;
    handleColorTokenChange(key, built);
  }

  function onSlotAlpha(key: keyof CustomColors, alpha: number) {
    slotAlpha[key] = alpha;
    const built = buildColor(slotHex[key], alpha);
    slotHexText[key] = built;
    handleColorTokenChange(key, built);
  }

  function onSlotHexText(key: keyof CustomColors, text: string) {
    slotHexText[key] = text;
    if (!isValidHex(text)) return; // wait for valid input
    slotHex[key] = toHex6(text);
    slotAlpha[key] = toAlpha(text);
    handleColorTokenChange(key, text);
  }

  function handleColorTokenChange(key: keyof CustomColors, value: string) {
    theme.setCustomColor(key, value);
  }

  function resetColorToken(key: keyof CustomColors) {
    theme.setCustomColor(key, null);
  }

  function resetAllColors() {
    theme.resetColors();
  }

  // ── Background ──────────────────────────────────────────────────────────────

  let bgType: BackgroundType = $theme.background.type;
  let bgOpacity = $theme.background.opacity;
  let bgBlur = $theme.background.blur;
  let bgFixed = $theme.background.fixed;
  let bgColorValue = $theme.background.type === "color" ? $theme.background.value : "#000000";
  let bgGradientValue = $theme.background.type === "gradient" ? $theme.background.value : "linear-gradient(135deg, #1a1a2e, #16213e)";
  let bgFileName = "";

  $: {
    bgType = $theme.background.type;
    bgOpacity = $theme.background.opacity;
    bgBlur = $theme.background.blur;
    bgFixed = $theme.background.fixed;
  }

  function setBgType(type: BackgroundType) {
    bgType = type;
    const val = type === "color" ? bgColorValue
              : type === "gradient" ? bgGradientValue
              : $theme.background.value;
    theme.setBackground({ type, value: val });
  }

  function setBgColor(value: string) {
    bgColorValue = value;
    theme.setBackground({ type: "color", value });
  }

  function setBgGradient(value: string) {
    bgGradientValue = value;
    theme.setBackground({ type: "gradient", value });
  }

  function setBgOpacity(v: number) {
    bgOpacity = v;
    theme.setBackground({ opacity: v });
  }

  function setBgBlur(v: number) {
    bgBlur = v;
    theme.setBackground({ blur: v });
  }

  function toggleBgFixed() {
    bgFixed = !bgFixed;
    theme.setBackground({ fixed: bgFixed });
  }

  async function pickBgFile(mediaType: "image" | "video") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const filters = mediaType === "image"
        ? [{ name: "Images", extensions: ["png","jpg","jpeg","webp","gif","avif"] }]
        : [{ name: "Videos", extensions: ["mp4","webm","mkv","mov"] }];
      const selected = await open({ filters, multiple: false });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected[0];
      const assetUrl = convertFileSrc(filePath);
      bgFileName = filePath.split(/[\\/]/).pop() ?? filePath;
      theme.setBackground({ type: mediaType, value: assetUrl });
    } catch (e) {
      console.error("[Theme] File pick failed:", e);
    }
  }

  function resetBackground() {
    bgFileName = "";
    theme.resetBackground();
  }

  // gradient presets
  const gradientPresets = [
    "linear-gradient(135deg, #1a1a2e, #16213e)",
    "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
    "linear-gradient(135deg, #200122, #6f0000)",
    "linear-gradient(135deg, #0d0d0d, #1a1a1a)",
    "radial-gradient(ellipse at top, #1b2735 0%, #090a0f 100%)",
    "linear-gradient(to bottom, #1a0533, #0a0a1a)",
  ];

  // ── Animation ───────────────────────────────────────────────────────────────

  const pageTransitions: { value: PageTransition; label: string }[] = [
    { value: 'none',  label: 'None' },
    { value: 'fade',  label: 'Fade' },
    { value: 'slide', label: 'Slide' },
    { value: 'scale', label: 'Scale' },
  ];

  const vizModes: { value: VisualizationMode; label: string }[] = [
    { value: 'none',       label: 'None' },
    { value: 'bars',       label: 'Bars' },
    { value: 'wave',       label: 'Wave' },
    { value: 'blur-pulse', label: 'Pulse' },
  ];

  const speedOptions: { value: TransitionSpeed; label: string }[] = [
    { value: 'slow',   label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast',   label: 'Fast' },
  ];

  // ── Theme package export / import ────────────────────────────────────────────

  let pkgName = '';
  let pkgAuthor = '';
  let pkgDescription = '';
  let pkgImportError = '';
  let pkgImportSuccess = '';

  async function handleExport() {
    const state = get(theme);
    const name = pkgName.trim() || 'My Theme';
    const pkg = exportThemePackage(state, name, pkgAuthor, pkgDescription);
    const json = JSON.stringify(pkg, null, 2);
    const fileName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() + '.audiotheme';

    if (isTauri()) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({ defaultPath: fileName, filters: [{ name: 'Audion Theme', extensions: ['audiotheme'] }] });
        if (!path) return;
        await writeTextFile(path, json);
        pkgImportSuccess = 'Theme exported!';
        setTimeout(() => { pkgImportSuccess = ''; }, 3000);
      } catch (e) {
        pkgImportError = String(e);
        setTimeout(() => { pkgImportError = ''; }, 5000);
      }
    } else {
      // Web fallback: Blob download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      pkgImportSuccess = 'Theme exported!';
      setTimeout(() => { pkgImportSuccess = ''; }, 3000);
    }
  }

  async function handleImport() {
    pkgImportError = '';
    pkgImportSuccess = '';

    if (isTauri()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const selected = await open({ filters: [{ name: 'Audion Theme', extensions: ['audiotheme'] }], multiple: false });
        if (!selected) return;
        const filePath = typeof selected === 'string' ? selected : selected[0];
        const text = await readTextFile(filePath);
        applyImported(text);
      } catch (e) {
        pkgImportError = String(e);
        setTimeout(() => { pkgImportError = ''; }, 5000);
      }
    } else {
      // Web fallback: file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.audiotheme,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        applyImported(await file.text());
      };
      input.click();
    }
  }

  function applyImported(text: string) {
    try {
      const raw = JSON.parse(text);
      const pkg = parseThemePackage(raw);
      theme.applyPackage({
        accentColor: pkg.accentColor,
        mode: pkg.mode,
        customColors: pkg.customColors,
        background: pkg.background,
        animation: pkg.animation,
      });
      pkgImportSuccess = `Applied "${pkg.name}"${pkg.author ? ` by ${pkg.author}` : ''}`;
      setTimeout(() => { pkgImportSuccess = ''; }, 4000);
    } catch (e) {
      pkgImportError = `Invalid theme file: ${e}`;
      setTimeout(() => { pkgImportError = ''; }, 5000);
    }
  }
</script>

<section class="settings-section" aria-labelledby="appearance-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="globe" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.appearance')}</span>
      <span class="accordion-subtitle">{$_('settings.appearanceSubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">

        <!-- Language -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.selectLanguage')}</span>
          <div class="segmented-pill" style="margin-top: 6px;">
            <button class="segment-btn" class:active={$locale === 'en'} on:click={() => changeLanguage('en')}>English</button>
            <button class="segment-btn" class:active={$locale === 'es'} on:click={() => changeLanguage('es')}>Español</button>
            <button class="segment-btn" class:active={$locale === 'fr'} on:click={() => changeLanguage('fr')}>Français</button>
            <button class="segment-btn" class:active={$locale === 'ru'} on:click={() => changeLanguage('ru')}>Русский</button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Layout mode -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.layoutMode')}</span>
          <span class="setting-description">{$_('settings.layoutModeDesc')}</span>
          <div class="segmented-pill" style="margin-top: 6px;">
            <button class="segment-btn" class:active={$layoutOverride === 'auto'} on:click={() => handleLayoutOverrideChange('auto')}><Icon name="sliders" size={14} />{$_('settings.layoutAuto')}</button>
            <button class="segment-btn" class:active={$layoutOverride === 'desktop'} on:click={() => handleLayoutOverrideChange('desktop')}><Icon name="monitor" size={14} />{$_('settings.layoutDesktop')}</button>
            <button class="segment-btn" class:active={$layoutOverride === 'mobile'} on:click={() => handleLayoutOverrideChange('mobile')}><Icon name="smartphone" size={14} />{$_('settings.layoutMobile')}</button>
            <button class="segment-btn" class:active={$layoutOverride === 'hybrid'} on:click={() => handleLayoutOverrideChange('hybrid')}>{$_('settings.layoutHybrid')}</button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Theme mode -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.themeMode')}</span>
          <div class="segmented-pill" style="margin-top: 6px;">
            <button class="segment-btn" class:active={$theme.mode === 'dark'} on:click={() => handleModeChange('dark')}>{$_('settings.dark')}</button>
            <button class="segment-btn" class:active={$theme.mode === 'light'} on:click={() => handleModeChange('light')}>{$_('settings.light')}</button>
            <button class="segment-btn" class:active={$theme.mode === 'system'} on:click={() => handleModeChange('system')}>{$_('settings.system')}</button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Accent color -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.accentColor')}</span>
          <div class="color-grid-compact" style="margin-top: 6px;">
            {#each presetAccents as preset}
              <button
                class="color-swatch-sm"
                class:active={$theme.accentColor === preset.color}
                style="background-color: {preset.color}"
                on:click={() => handleAccentChange(preset.color)}
                title={preset.name}
              ></button>
            {/each}
            {#each $theme.customAccentColors as c}
              <button
                class="color-swatch-sm"
                class:active={$theme.accentColor === c}
                style="background-color: {c}"
                on:click={() => handleAccentChange(c)}
                title={c}
              ></button>
            {/each}
          </div>
          <div class="custom-color-row" style="margin-top: 8px;">
            <input type="color" bind:value={customColorInput} class="color-picker-input" title="Pick custom accent" />
            <input type="text" bind:value={customColorInput} class="color-hex-input" placeholder="#1DB954" maxlength="7" />
            <button class="btn-add-color" on:click={handleCustomColorAdd}>Add</button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- ── Custom color tokens ── -->
        <div class="inner-section">
          <div class="section-header-row">
            <span class="setting-title">Custom Colors</span>
            <button class="btn-reset-small" on:click={resetAllColors} title="Reset all to defaults">Reset all</button>
          </div>
          <span class="setting-description">Override individual color tokens. Leave unset to use theme defaults.</span>
          <div class="color-token-grid">
            {#each colorSlots as slot}
              {@const current = $theme.customColors[slot.key]}
              <div class="color-token-row">
                <span class="token-label">{slot.label}</span>
                <div class="token-controls">
                  <!-- native color swatch (6-char only, drives hex6) -->
                  <input
                    type="color"
                    value={slotHex[slot.key]}
                    class="color-picker-input"
                    on:input={e => onSlotColorPick(slot.key, (e.target as HTMLInputElement).value)}
                    title={slot.label}
                  />
                  <!-- hex + alpha text input -->
                  <input
                    type="text"
                    value={slotHexText[slot.key]}
                    class="color-hex-input token-hex"
                    maxlength="9"
                    spellcheck="false"
                    placeholder="#000000"
                    on:input={e => onSlotHexText(slot.key, (e.target as HTMLInputElement).value)}
                  />
                  <!-- alpha slider -->
                  <div class="alpha-slider-wrap" title="Opacity">
                    <div class="alpha-track" style="--color6: {slotHex[slot.key]}">
                      <input
                        type="range" min="0" max="1" step="0.01"
                        value={slotAlpha[slot.key]}
                        class="alpha-range"
                        on:input={e => onSlotAlpha(slot.key, parseFloat((e.target as HTMLInputElement).value))}
                      />
                    </div>
                    <span class="slider-val">{Math.round(slotAlpha[slot.key] * 100)}%</span>
                  </div>
                  {#if current !== null}
                    <button class="btn-reset-token" on:click={() => resetColorToken(slot.key)} title="Reset to default">✕</button>
                  {:else}
                    <span class="token-default-badge">default</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="divider"></div>

        <!-- ── Background ── -->
        <div class="inner-section">
          <div class="section-header-row">
            <span class="setting-title">Background</span>
            {#if $theme.background.type !== 'none'}
              <button class="btn-reset-small" on:click={resetBackground}>Remove</button>
            {/if}
          </div>
          <span class="setting-description">Custom background behind the app. Adjust opacity to keep UI readable.</span>

          <!-- Type selector -->
          <div class="segmented-pill" style="margin-top: 8px;">
            <button class="segment-btn" class:active={bgType === 'none'}    on:click={() => setBgType('none')}>None</button>
            <button class="segment-btn" class:active={bgType === 'color'}   on:click={() => setBgType('color')}>Color</button>
            <button class="segment-btn" class:active={bgType === 'gradient'} on:click={() => setBgType('gradient')}>Gradient</button>
            <button class="segment-btn" class:active={bgType === 'image'}   on:click={() => setBgType('image')}>Image</button>
            {#if isTauri()}
              <button class="segment-btn" class:active={bgType === 'video'} on:click={() => setBgType('video')}>Video</button>
            {/if}
          </div>

          {#if bgType === 'color'}
            <div class="bg-control-row" style="margin-top: 10px;">
              <label class="token-label">Color</label>
              <input type="color" value={bgColorValue} class="color-picker-input" on:input={e => setBgColor((e.target as HTMLInputElement).value)} />
            </div>
          {/if}

          {#if bgType === 'gradient'}
            <div style="margin-top: 10px;">
              <label class="token-label">Gradient CSS</label>
              <textarea
                class="gradient-input"
                rows="2"
                value={bgGradientValue}
                on:input={e => setBgGradient((e.target as HTMLTextAreaElement).value)}
                placeholder="linear-gradient(135deg, #1a1a2e, #16213e)"
                spellcheck="false"
              ></textarea>
              <div class="gradient-presets">
                {#each gradientPresets as g}
                  <button
                    class="gradient-preset-btn"
                    style="background: {g}"
                    on:click={() => { bgGradientValue = g; setBgGradient(g); }}
                    title={g}
                  ></button>
                {/each}
              </div>
            </div>
          {/if}

          {#if bgType === 'image'}
            <div style="margin-top: 10px;">
              {#if isTauri()}
                <button class="btn-pick-file" on:click={() => pickBgFile('image')}>
                  <Icon name="image" size={14} />
                  {bgFileName || "Choose image…"}
                </button>
              {:else}
                <span class="setting-description">Image backgrounds require the desktop app.</span>
              {/if}
            </div>
          {/if}

          {#if bgType === 'video'}
            <div style="margin-top: 10px;">
              <button class="btn-pick-file" on:click={() => pickBgFile('video')}>
                <Icon name="film" size={14} />
                {bgFileName || "Choose video…"}
              </button>
            </div>
          {/if}

          <!-- Shared controls for all active types -->
          {#if bgType !== 'none'}
            <div class="bg-sliders">
              <div class="slider-row">
                <span class="token-label">Opacity</span>
                <input type="range" min="0" max="1" step="0.01" value={bgOpacity}
                  on:input={e => setBgOpacity(parseFloat((e.target as HTMLInputElement).value))} />
                <span class="slider-val">{Math.round(bgOpacity * 100)}%</span>
              </div>
              <div class="slider-row">
                <span class="token-label">Blur</span>
                <input type="range" min="0" max="40" step="1" value={bgBlur}
                  on:input={e => setBgBlur(parseInt((e.target as HTMLInputElement).value))} />
                <span class="slider-val">{bgBlur}px</span>
              </div>
              <label class="checkbox-row">
                <input type="checkbox" checked={bgFixed} on:change={toggleBgFixed} />
                <span class="token-label">Fixed (parallax)</span>
              </label>
            </div>
          {/if}
        </div>

        <div class="divider"></div>

        <!-- ── Animations ── -->
        <div class="inner-section">
          <span class="setting-title">Animations</span>
          <span class="setting-description">Control transitions, visualizer, and motion effects.</span>

          <!-- Reduced motion override -->
          <label class="checkbox-row" style="margin-top: 10px;">
            <input type="checkbox"
              checked={$theme.animation.reducedMotion}
              on:change={e => theme.setAnimation({ reducedMotion: (e.target as HTMLInputElement).checked })}
            />
            <span class="token-label">Reduce motion (overrides all below)</span>
          </label>

          <!-- Page transition -->
          <div style="margin-top: 12px;">
            <span class="token-label">Page transition</span>
            <div class="segmented-pill" style="margin-top: 6px;">
              {#each pageTransitions as pt}
                <button class="segment-btn"
                  class:active={$theme.animation.pageTransition === pt.value}
                  on:click={() => theme.setAnimation({ pageTransition: pt.value })}
                >{pt.label}</button>
              {/each}
            </div>
          </div>

          <!-- Transition speed -->
          <div style="margin-top: 12px;">
            <span class="token-label">Transition speed</span>
            <div class="segmented-pill" style="margin-top: 6px;">
              {#each speedOptions as sp}
                <button class="segment-btn"
                  class:active={$theme.animation.transitionSpeed === sp.value}
                  on:click={() => theme.setAnimation({ transitionSpeed: sp.value })}
                >{sp.label}</button>
              {/each}
            </div>
          </div>

          <!-- Visualizer -->
          <div style="margin-top: 12px;">
            <span class="token-label">Player visualizer</span>
            <div class="segmented-pill" style="margin-top: 6px;">
              {#each vizModes as vm}
                <button class="segment-btn"
                  class:active={$theme.animation.playerVisualization === vm.value}
                  on:click={() => theme.setAnimation({ playerVisualization: vm.value })}
                >{vm.label}</button>
              {/each}
            </div>
          </div>

          <!-- Toggles -->
          <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
            <label class="checkbox-row">
              <input type="checkbox"
                checked={$theme.animation.hoverScale}
                on:change={e => theme.setAnimation({ hoverScale: (e.target as HTMLInputElement).checked })}
              />
              <span class="token-label">Card hover lift &amp; scale</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox"
                checked={$theme.animation.accentPulse}
                on:change={e => theme.setAnimation({ accentPulse: (e.target as HTMLInputElement).checked })}
              />
              <span class="token-label">Accent pulse on playing indicator</span>
            </label>
          </div>
        </div>

        <div class="divider"></div>

        <!-- ── Theme Package ── -->
        <div class="inner-section">
          <span class="setting-title">Theme Package</span>
          <span class="setting-description">Export your theme as a shareable <code>.audiotheme</code> file, or import one.</span>

          <!-- Export fields -->
          <div class="pkg-fields">
            <input class="pkg-input" type="text" bind:value={pkgName} placeholder="Theme name" maxlength="64" />
            <input class="pkg-input" type="text" bind:value={pkgAuthor} placeholder="Author (optional)" maxlength="64" />
            <input class="pkg-input" type="text" bind:value={pkgDescription} placeholder="Description (optional)" maxlength="120" />
          </div>

          <div class="pkg-actions">
            <button class="btn-pkg btn-pkg-export" on:click={handleExport}>
              <Icon name="download" size={14} /> Export
            </button>
            <button class="btn-pkg btn-pkg-import" on:click={handleImport}>
              <Icon name="upload" size={14} /> Import
            </button>
          </div>

          {#if pkgImportSuccess}
            <span class="pkg-msg pkg-msg-ok">{pkgImportSuccess}</span>
          {/if}
          {#if pkgImportError}
            <span class="pkg-msg pkg-msg-err">{pkgImportError}</span>
          {/if}

          <span class="setting-description" style="margin-top: 8px;">
            Note: image and video backgrounds are not included (paths are device-specific).
          </span>
        </div>

      </div>
    </div>
  {/if}
</section>

<style>
  /* ── Existing color-grid-compact & color-swatch-sm expected from settings/styles.css ── */

  .custom-color-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-picker-input {
    width: 36px;
    height: 36px;
    padding: 2px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    cursor: pointer;
    flex-shrink: 0;
  }

  .color-hex-input {
    width: 90px;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: monospace;
  }

  .btn-add-color {
    padding: 6px 12px;
    background: var(--accent-primary);
    color: #fff;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .btn-add-color:hover { background: var(--accent-hover); }

  /* ── Color token grid ── */

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .btn-reset-small {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
    padding: 3px 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }
  .btn-reset-small:hover { color: var(--text-primary); border-color: var(--text-secondary); }

  .color-token-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }

  .color-token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .token-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    flex: 1;
  }

  .token-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* narrower hex field inside token rows */
  .token-hex {
    width: 78px;
    font-size: 11px;
    padding: 4px 6px;
  }

  /* alpha slider composite */
  .alpha-slider-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* checkerboard + gradient track */
  .alpha-track {
    position: relative;
    width: 64px;
    height: 16px;
    border-radius: 4px;
    /* checkerboard underneath */
    background-image:
      linear-gradient(45deg, #888 25%, transparent 25%),
      linear-gradient(-45deg, #888 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #888 75%),
      linear-gradient(-45deg, transparent 75%, #888 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
    background-color: #fff;
    /* color-to-transparent gradient on top */
    border: 1px solid var(--border-color);
    overflow: visible;
  }

  .alpha-track::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 3px;
    background: linear-gradient(to right, transparent, var(--color6, #000));
    pointer-events: none;
  }

  .alpha-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    margin: 0;
  }

  .btn-reset-token {
    font-size: 11px;
    color: var(--text-subdued);
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    transition: color var(--transition-fast);
  }
  .btn-reset-token:hover { color: var(--error-color); }

  .token-default-badge {
    font-size: 10px;
    color: var(--text-subdued);
    font-style: italic;
  }

  /* ── Background controls ── */

  .bg-control-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .gradient-input {
    width: 100%;
    margin-top: 6px;
    padding: 8px;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-family: monospace;
    resize: vertical;
    user-select: text;
    -webkit-user-select: text;
  }

  .gradient-presets {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .gradient-preset-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color var(--transition-fast), transform var(--transition-fast);
  }
  .gradient-preset-btn:hover {
    border-color: var(--text-secondary);
    transform: scale(1.1);
  }

  .btn-pick-file {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background var(--transition-fast);
  }
  .btn-pick-file:hover { background: var(--bg-highlight); }

  .bg-sliders {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .slider-row input[type="range"] {
    flex: 1;
    accent-color: var(--accent-primary);
  }

  .slider-val {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    min-width: 36px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .checkbox-row input[type="checkbox"] {
    accent-color: var(--accent-primary);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .setting-description {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
    margin-top: 2px;
    display: block;
  }

  /* ── Theme package ── */

  .pkg-fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }

  .pkg-input {
    padding: 7px 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--transition-fast);
  }
  .pkg-input:focus { outline: none; border-color: var(--accent-primary); }
  .pkg-input::placeholder { color: var(--text-subdued); }

  .pkg-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .btn-pkg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition-fast), opacity var(--transition-fast);
  }

  .btn-pkg-export {
    background: var(--accent-primary);
    color: #fff;
  }
  .btn-pkg-export:hover { background: var(--accent-hover); }

  .btn-pkg-import {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }
  .btn-pkg-import:hover { background: var(--bg-highlight); }

  .pkg-msg {
    display: block;
    margin-top: 8px;
    font-size: var(--font-size-xs);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
  }
  .pkg-msg-ok  { background: color-mix(in srgb, var(--accent-primary) 15%, transparent); color: var(--accent-primary); }
  .pkg-msg-err { background: color-mix(in srgb, var(--error-color, #e74c3c) 12%, transparent); color: var(--error-color, #e74c3c); }

  code {
    font-family: monospace;
    font-size: 0.9em;
    background: var(--bg-surface);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>
