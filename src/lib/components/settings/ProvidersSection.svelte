<script lang="ts">
  import { _ } from "svelte-i18n";
  import Icon from "$lib/components/Icon.svelte";
  import { providersStore, globalProviders, type ProviderItemEntry } from "$lib/plugins/providers";
  import { addToast } from "$lib/stores/toast";
  import { goToPlugins } from "$lib/stores/view";
  import { pluginStore } from "$lib/stores/plugin-store";
  import { getCapabilityLabel, humanizeIdentifier, type Translate } from "$lib/plugins/categories";

  type ProviderType = "stream" | "metadata" | "lyrics";

  const SECTIONS: {
    type: ProviderType;
    icon: string;
    title: string;
    desc: string;
    emptyTitle: string;
    emptyHint: string;
  }[] = [
    {
      type: "stream",
      icon: "radio",
      title: "Audio Stream Providers",
      desc: "Resolves full-length playback streams. Priority #1 is tried first, with automatic fallback.",
      emptyTitle: "No audio stream providers registered",
      emptyHint: "Add an audio stream provider plugin or media server to play catalog tracks.",
    },
    {
      type: "metadata",
      icon: "search",
      title: "Metadata Catalog Providers",
      desc: "Searches remote catalogs for artwork, album details, and artist discovery.",
      emptyTitle: "No metadata catalog providers registered",
      emptyHint: "Install a metadata plugin to enable remote catalog searches.",
    },
    {
      type: "lyrics",
      icon: "mic-2",
      title: "Synchronized Lyrics Providers",
      desc: "Retrieves timestamped LRC lines and syllable karaoke tokens for active playback.",
      emptyTitle: "No lyrics providers registered",
      emptyHint: "Install a lyrics plugin to fetch synced lyrics automatically.",
    },
  ];

  $: providers = $providersStore;

  $: providersByType = {
    stream: providers.filter((p) => p.type === "stream").sort((a, b) => a.priority - b.priority),
    metadata: providers.filter((p) => p.type === "metadata").sort((a, b) => a.priority - b.priority),
    lyrics: providers.filter((p) => p.type === "lyrics").sort((a, b) => a.priority - b.priority),
  };

  const tr: Translate = (key, fallback) => $_(key, { default: fallback });

  // Provider owners arrive as display name, safe_name, or folder name.
  function ownerDisplay(owner: string): string {
    const match = $pluginStore.installed.find(
      (p) => p.folder_name === owner || p.manifest.safe_name === owner || p.name === owner
    );
    return match?.manifest.name ?? humanizeIdentifier(owner || "system");
  }

  function listFor(type: ProviderType, all: ProviderItemEntry[] = providers): ProviderItemEntry[] {
    return providersByType[type] || all.filter((p) => p.type === type).sort((a, b) => a.priority - b.priority);
  }

  function toggleProvider(type: ProviderType, id: string, current: boolean) {
    globalProviders.setProviderEnabled(type, id, !current);
    addToast(`${humanizeIdentifier(id)} ${!current ? "enabled" : "disabled"}`, "info");
  }

  function movePriority(type: ProviderType, id: string, direction: "up" | "down") {
    globalProviders.moveProviderPriority(type, id, direction);
  }

  function resetPriorities(type: ProviderType) {
    globalProviders.resetPriorities(type);
    addToast(`Reset ${getCapabilityLabel(type, tr)} provider priorities`, "info");
  }
</script>

<section class="settings-section">
  {#if providers.length === 0}
    <div class="settings-card providers-empty">
      <Icon name="plugin" size={40} />
      <h3>No providers yet</h3>
      <p>Providers come from installed plugins. Head to the Plugin Manager to install one.</p>
      <button class="btn-primary" on:click={goToPlugins}>Browse Plugins</button>
    </div>
  {:else}
    {#each SECTIONS as section (section.type)}
      {@const list = listFor(section.type, providers)}
      <div class="provider-category" id={`setting-providers-${section.type}`}>
        <div class="category-header">
          <div class="category-title-group">
            <Icon name={section.icon} size={16} />
            <div>
              <h3>{section.title} ({list.length})</h3>
              <span class="category-desc">{section.desc}</span>
            </div>
          </div>
          {#if list.length > 1}
            <button class="btn-outline-compact btn-reset-order" on:click={() => resetPriorities(section.type)}>
              Reset Order
            </button>
          {/if}
        </div>

        {#if list.length === 0}
          <div class="category-empty">
            <p>{section.emptyTitle}</p>
            <span>{section.emptyHint}</span>
          </div>
        {:else}
          <div class="settings-card">
            {#each list as prov, idx (prov.id)}
              <div class="provider-row" class:disabled={!prov.enabled}>
                <div class="provider-info">
                  <div class="toggle-container">
                    <div class="provider-text">
                      <div class="provider-name-row">
                        <span class="provider-rank">#{idx + 1}</span>
                        <span class="setting-title">{prov.name}</span>
                        <span class="pill-badge" title={prov.ownerPlugin}>{ownerDisplay(prov.ownerPlugin)}</span>
                      </div>
                      {#if prov.description}
                        <p class="setting-description">{prov.description}</p>
                      {/if}
                    </div>
                    <button
                      class="toggle-btn"
                      class:active={prov.enabled}
                      role="switch"
                      aria-checked={prov.enabled}
                      aria-label={`${prov.enabled ? "Disable" : "Enable"} ${prov.name}`}
                      on:click={() => toggleProvider(section.type, prov.id, prov.enabled)}
                    >
                      <div class="toggle-handle"></div>
                    </button>
                  </div>
                </div>
                <div class="provider-actions">
                  <span class="provider-id-tag" title={prov.id}
                    >{getCapabilityLabel(section.type, tr)}</span
                  >
                  <div class="priority-reorder-btns">
                    <button
                      class="icon-btn-sm"
                      disabled={idx === 0}
                      title="Increase priority"
                      aria-label="Increase priority"
                      on:click={() => movePriority(section.type, prov.id, "up")}
                    >
                      <Icon name="chevron-up" size={14} />
                    </button>
                    <button
                      class="icon-btn-sm"
                      disabled={idx === list.length - 1}
                      title="Decrease priority"
                      aria-label="Decrease priority"
                      on:click={() => movePriority(section.type, prov.id, "down")}
                    >
                      <Icon name="chevron-down" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  .settings-card {
    padding: 0;
    gap: 0;
  }

  .providers-empty {
    align-items: center;
    text-align: center;
    gap: var(--spacing-sm);
    color: var(--text-secondary);
  }

  .providers-empty h3 {
    margin: 0;
    font-size: var(--font-size-base);
    color: var(--text-primary);
  }

  .providers-empty p {
    margin: 0;
    font-size: var(--font-size-sm);
    max-width: 40ch;
  }

  .provider-category {
    margin-bottom: var(--spacing-lg);
  }

  .provider-category:last-child {
    margin-bottom: 0;
  }

  .category-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
  }

  .category-title-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--text-subdued);
  }

  .category-title-group h3 {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .category-desc {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
  }

  .btn-reset-order {
    flex-shrink: 0;
  }

  .category-empty {
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--spacing-lg);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .category-empty p {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .category-empty span {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
  }

  .provider-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
  }

  .provider-row:last-child {
    border-bottom: none;
  }

  .provider-row.disabled .provider-text {
    opacity: 0.5;
  }

  .provider-info {
    flex: 1;
    min-width: 0;
  }

  .provider-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .provider-name-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--spacing-xs) var(--spacing-sm);
  }

  .provider-rank {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    color: var(--text-subdued);
    font-family: monospace;
  }

  .provider-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-shrink: 0;
  }

  .provider-id-tag {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }

  .priority-reorder-btns {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn-sm {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-subdued);
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--transition-fast), background-color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .icon-btn-sm:hover:not(:disabled) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .icon-btn-sm:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  :global(html.layout-mobile) .provider-row {
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }

  :global(html.layout-mobile) .provider-actions {
    width: 100%;
    justify-content: space-between;
  }
</style>
