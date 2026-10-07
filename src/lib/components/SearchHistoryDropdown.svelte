<script lang="ts">
  import { _ } from 'svelte-i18n';
  import {
    resolvedSearchHistory,
    removeHistoryItem,
    clearHistory,
    clearSearch,
    type ResolvedHistoryEntry,
  } from '$lib/stores/search';
  import { goToAlbumDetail, goToArtistDetail, goToPlaylistDetail } from '$lib/stores/view';
  import Icon from '$lib/components/Icon.svelte';
  import ArtistLinks from '$lib/components/ArtistLinks.svelte';

  export let onSelectQuery: (query: string) => void;
  export let onClose: () => void;

  function handleSelect(entry: ResolvedHistoryEntry) {
    if (entry.type === 'query') {
      onSelectQuery(entry.query ?? '');
      return;
    }
    onClose();
    if (entry.type === 'album' && entry.id !== undefined) {
      clearSearch();
      goToAlbumDetail(entry.id);
    } else if (entry.type === 'playlist' && entry.id !== undefined) {
      clearSearch();
      goToPlaylistDetail(entry.id, entry.label);
    } else if (entry.type === 'track') {
      // Re-search by track title
      onSelectQuery(entry.label);
    }
  }

  function handleArtistClick(artistName: string) {
    onClose();
    clearSearch();
    goToArtistDetail(artistName);
  }

  function handleRemove(e: MouseEvent, index: number) {
    e.stopPropagation();
    removeHistoryItem(index);
  }

  function handleClear() {
    clearHistory();
  }

  function iconForType(type: ResolvedHistoryEntry['type']): string {
    if (type === 'query') return 'search';
    if (type === 'track') return 'music';
    if (type === 'album') return 'disc-3';
    return 'list-music';
  }
</script>

{#if $resolvedSearchHistory.length > 0}
  <!-- preventDefault on mousedown keeps input focused when clicking dropdown items -->
  <div class="search-history-dropdown" role="listbox" on:mousedown|preventDefault>
    <div class="history-header">
      <span class="history-title">{$_('search.searchHistory')}</span>
      <button class="clear-btn" on:click={handleClear}>
        {$_('search.searchHistoryClear')}
      </button>
    </div>
    <ul class="history-list">
      {#each $resolvedSearchHistory as entry (entry.index)}
        <li class="history-item" role="option" aria-selected="false">
          <div
            class="history-item-btn"
            role="button"
            tabindex="0"
            on:click={() => handleSelect(entry)}
            on:keydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect(entry);
              }
            }}
          >
            <div class="item-art">
              {#if entry.type !== 'query' && entry.art}
                <img
                  src={entry.art}
                  alt=""
                  class="art-img"
                  class:round={entry.type === 'playlist'}
                />
              {:else}
                <div class="art-icon" class:query-icon={entry.type === 'query'}>
                  <Icon name={iconForType(entry.type)} size={16} />
                </div>
              {/if}
            </div>
            <div class="item-info">
              <span class="item-label">{entry.label}</span>
              {#if (entry.type === 'track' || entry.type === 'album') && entry.subLabel}
                <span class="item-sub">
                  <ArtistLinks
                    artist={entry.subLabel}
                    artists={entry.subLabelArtists}
                    chipClass="item-sub-chip"
                    on:select={(e) => handleArtistClick(e.detail)}
                  />
                </span>
              {/if}
              {#if entry.type !== 'query'}
                <span class="item-type">{entry.type}</span>
              {/if}
            </div>
          </div>
          <button
            class="remove-btn"
            title={$_('search.searchHistoryRemove')}
            on:click={(e) => handleRemove(e, entry.index)}
            aria-label={$_('search.searchHistoryRemove')}
          >
            <Icon name="x" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .search-history-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 9000;
    overflow: hidden;
    min-width: 280px;
    max-height: 400px;
    overflow-y: auto;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 6px;
  }

  .history-title {
    font-size: 0.72rem;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subdued);
  }

  .clear-btn {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    transition: color var(--transition-fast);
  }

  .clear-btn:hover { color: var(--text-primary); }

  .history-list {
    list-style: none;
    padding: 4px 0 6px;
    margin: 0;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .history-item-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--transition-fast);
    min-width: 0;
  }

  .history-item-btn:hover { background-color: var(--bg-surface); }

  .item-art {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .art-img {
    width: 36px;
    height: 36px;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .art-img.round { border-radius: var(--radius-full); }

  .art-icon {
    width: 36px;
    height: 36px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
  }

  .art-icon.query-icon {
    background: transparent;
    color: var(--text-subdued);
  }

  .item-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .item-label {
    font-size: 0.9rem;
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-sub {
    display: block;
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
    min-width: 0;
    overflow: hidden;
  }

  .item-sub :global(.artist-links-full) {
    max-width: 100%;
  }

  .item-sub :global(.item-sub-chip) {
    color: inherit;
  }

  .item-type {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-subdued);
    opacity: 0.7;
  }

  .remove-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
    background: none;
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    opacity: 0;
    margin-right: 8px;
    transition: opacity var(--transition-fast), color var(--transition-fast);
  }

  .history-item:hover .remove-btn { opacity: 1; }
  .remove-btn:hover { color: var(--text-primary); }
</style>
