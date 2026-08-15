<script lang="ts">
  import { _ } from "svelte-i18n";
  import { theme, presetAccents, type ThemeMode } from "$lib/stores/theme";
  import { locale } from "svelte-i18n";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  function handleModeChange(mode: ThemeMode) {
    theme.setMode(mode);
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
</script>

<section class="settings-section" aria-labelledby="appearance-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.appearance')}</span>
      <span class="accordion-subtitle">{$_('settings.appearanceSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
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

    <div class="inner-section">
      <span class="setting-title">{$_('settings.themeMode')}</span>
      <div class="segmented-pill" style="margin-top: 6px;">
        <button class="segment-btn" class:active={$theme.mode === 'dark'} on:click={() => handleModeChange('dark')}>{$_('settings.dark')}</button>
        <button class="segment-btn" class:active={$theme.mode === 'light'} on:click={() => handleModeChange('light')}>{$_('settings.light')}</button>
        <button class="segment-btn" class:active={$theme.mode === 'system'} on:click={() => handleModeChange('system')}>{$_('settings.system')}</button>
      </div>
    </div>

    <div class="divider"></div>

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
      </div>
    </div>
    </div>
  </div>
  {/if}
</section>
