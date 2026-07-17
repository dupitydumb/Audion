<script lang="ts">
  import AudioSection from "./settings/AudioSection.svelte";
  import EqualizerEditor from "./settings/EqualizerEditor.svelte";
  import AppearanceSection from "./settings/AppearanceSection.svelte";
  import StartupSection from "./settings/StartupSection.svelte";
  import PlaybackSection from "./settings/PlaybackSection.svelte";
  import SyncSection from "./settings/SyncSection.svelte";
  import AccountSection from "./settings/AccountSection.svelte";
  import StorageSection from "./settings/StorageSection.svelte";
  import ArtistsSection from "./settings/ArtistsSection.svelte";
  import LyricsSection from "./settings/LyricsSection.svelte";
  import ShortcutsSection from "./settings/ShortcutsSection.svelte";
  import PrivacySection from "./settings/PrivacySection.svelte";
  import CommunitySection from "./settings/CommunitySection.svelte";
  import UpgradeSection from "./settings/UpgradeSection.svelte";
  import AboutSection from "./settings/AboutSection.svelte";
  import SupportSection from "./settings/SupportSection.svelte";
  import "./settings/styles.css";
  import { _ } from "svelte-i18n";

  let openSections: Record<string, boolean> = {};
  let showEqEditor = false;

  function toggle(section: string) {
    const isCurrentlyOpen = !!openSections[section];
    openSections = { [section]: !isCurrentlyOpen };
  }
</script>

<div class="settings-view">
  <header class="view-header">
    <h1>{$_('settings.title', { default: 'Settings' })}</h1>
  </header>

  <div class="settings-content">
    <div class="settings-pane-slider" class:show-subsection={showEqEditor}>
      <div class="settings-pane settings-container">
        <AudioSection open={openSections['audio'] ?? false} on:toggle={() => toggle('audio')} on:openEqEditor={() => showEqEditor = true} />
        <AppearanceSection open={openSections['appearance'] ?? false} on:toggle={() => toggle('appearance')} />
        <StartupSection open={openSections['startup'] ?? false} on:toggle={() => toggle('startup')} />
        <PlaybackSection open={openSections['playback'] ?? false} on:toggle={() => toggle('playback')} />
        <SyncSection open={openSections['sync'] ?? false} on:toggle={() => toggle('sync')} />
        <AccountSection open={openSections['account'] ?? false} on:toggle={() => toggle('account')} />
        <StorageSection open={openSections['storage'] ?? false} on:toggle={() => toggle('storage')} />
        <ArtistsSection open={openSections['artists'] ?? false} on:toggle={() => toggle('artists')} />
        <LyricsSection open={openSections['lyrics'] ?? false} on:toggle={() => toggle('lyrics')} />
        <ShortcutsSection open={openSections['shortcuts'] ?? false} on:toggle={() => toggle('shortcuts')} />
        <PrivacySection open={openSections['privacy'] ?? false} on:toggle={() => toggle('privacy')} />
        <CommunitySection open={openSections['community'] ?? false} on:toggle={() => toggle('community')} />
        <UpgradeSection open={openSections['upgrade'] ?? false} on:toggle={() => toggle('upgrade')} />
        <AboutSection open={openSections['about'] ?? false} on:toggle={() => toggle('about')} />
        <SupportSection open={openSections['support'] ?? false} on:toggle={() => toggle('support')} />
      </div>
      <div class="settings-pane">
        {#if showEqEditor}
          <EqualizerEditor on:back={() => showEqEditor = false} />
        {/if}
      </div>
    </div>
  </div>
</div>