<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import SettingRow from "./SettingRow.svelte";
  import SettingToggle from "./SettingToggle.svelte";

  export let open: boolean = true;
</script>

<section class="settings-section" aria-labelledby="playback-heading">
  <div class="settings-card">
    <SettingRow
      id="setting-autoplay"
      label={$_('settings.autoplay', { default: 'Autoplay' })}
      description={$_('settings.autoplayDesc', { default: 'Automatically queue similar music when your playback queue ends.' })}
    >
      <SettingToggle
        checked={$appSettings.autoplay}
        label={$_('settings.toggleAutoplay', { default: 'Toggle Autoplay' })}
        on:change={(e) => appSettings.setAutoplay(e.detail)}
      />
    </SettingRow>
  </div>
</section>

<style>
  .settings-section {
    margin-bottom: var(--spacing-md, 16px);
  }

  .settings-card {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border-color);
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
