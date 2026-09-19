<script lang="ts">
  import type { Track } from "$lib/api/tauri";
  import { multiSelect } from "$lib/stores/multiselect";
  import { _ } from "svelte-i18n";

  export let multiSelectMode = false;
  export let showAlbum = true;
  export let playlistId: number | null = null;
  export let scrollbarWidth = 0;
  export let sortedTracks: Track[] = [];
  export let sortField: string | null = null;
  export let sortDirection: "asc" | "desc" = "asc";

  export let toggleSort: (field: any) => void;

  // lets a parent (e.g. PlaylistDetail) offer a way into multiSelectMode
  // via a hover reveal checkbox in the leading corner
  export let allowMultiSelectEntry = false;
  export let onEnterMultiSelect: (() => void) | undefined = undefined;
</script>

<header
  class="list-header"
  class:no-album={!showAlbum}
  class:with-drag={playlistId !== null}
  class:multiselect={multiSelectMode}
  style={`--scrollbar-width: ${scrollbarWidth}px`}
>
  {#if multiSelectMode}
    <div class="col-header col-checkbox">
      <div
        class="custom-checkbox"
        class:checked={$multiSelect.selectedTrackIds.size > 0 &&
          $multiSelect.selectedTrackIds.size === sortedTracks.length}
        class:indeterminate={$multiSelect.selectedTrackIds.size > 0 &&
          $multiSelect.selectedTrackIds.size < sortedTracks.length}
        role="checkbox"
        tabindex="0"
        aria-checked={$multiSelect.selectedTrackIds.size === 0
          ? false
          : $multiSelect.selectedTrackIds.size === sortedTracks.length
            ? true
            : "mixed"}
        on:click={() => {
          if (
            sortedTracks.length > 0 &&
            $multiSelect.selectedTrackIds.size === sortedTracks.length
          ) {
            multiSelect.clearSelections();
          } else {
            multiSelect.selectAll(sortedTracks.map((t) => t.id));
          }
        }}
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (
              sortedTracks.length > 0 &&
              $multiSelect.selectedTrackIds.size === sortedTracks.length
            ) {
              multiSelect.clearSelections();
            } else {
              multiSelect.selectAll(sortedTracks.map((t) => t.id));
            }
          }
        }}
      >
        {#if $multiSelect.selectedTrackIds.size > 0 && $multiSelect.selectedTrackIds.size === sortedTracks.length}
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        {:else if $multiSelect.selectedTrackIds.size > 0}
          <span class="indeterminate-dash"></span>
        {/if}
      </div>
    </div>
  {/if}
  {#if playlistId !== null && !multiSelectMode}
    <span class="col-header col-drag" class:selectable={allowMultiSelectEntry}>
      {#if allowMultiSelectEntry}
        <div
          class="custom-checkbox enter-select-checkbox"
          role="checkbox"
          tabindex="0"
          aria-checked="false"
          aria-label={$_('trackList.selectTracks', { default: 'Select tracks' })}
          on:click={() => {
            onEnterMultiSelect?.();
            multiSelect.selectAll(sortedTracks.map((t) => t.id));
          }}
          on:keydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onEnterMultiSelect?.();
              multiSelect.selectAll(sortedTracks.map((t) => t.id));
            }
          }}
        ></div>
      {/if}
    </span>
  {/if}
  <button class="col-header col-num sortable" on:click={() => toggleSort("track_number")}>
    #
    {#if sortField === "track_number"}
      <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
    {/if}
  </button>
  <button
    class="col-header col-artist sortable"
    on:click={() => toggleSort("title")}
  >
    {$_('trackList.title')}
    {#if sortField === "title"}
      <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
    {/if}
  </button>
  {#if showAlbum}
    <button
      class="col-header col-album sortable"
      on:click={() => toggleSort("album")}
    >
      {$_('trackList.album')}
      {#if sortField === "album"}
        <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
      {/if}
    </button>
  {/if}
  <button
    class="col-header col-duration sortable"
    on:click={() => toggleSort("duration")}
  >
    {$_('trackList.duration')}
    {#if sortField === "duration"}
      <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
    {/if}
  </button>
  <button
    class="col-header col-date-added sortable"
    on:click={() => toggleSort("date_added")}
  >
    {$_('trackList.dateAdded')}
    {#if sortField === "date_added"}
      <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
    {/if}
  </button>
</header>
