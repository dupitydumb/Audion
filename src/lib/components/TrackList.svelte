<script lang="ts">
  import TrackList from "./track-list/TrackList.svelte";
</script>

<TrackList {...$$props} on:scroll on:click on:dblclick on:contextmenu />
