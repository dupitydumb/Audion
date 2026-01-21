<script lang="ts">
    import { onMount } from "svelte";
    import { appSettings } from "$lib/stores/settings";
    import { theme } from "$lib/stores/theme";
    import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
    import TitleBar from "$lib/components/TitleBar.svelte";
    import "../app.css";

    onMount(() => {
        appSettings.initialize();
        theme.initialize();
    });
</script>

<TitleBar />
<ConfirmDialog />
<div class="app-content">
    <slot />
</div>

<style>
    .app-content {
        padding-top: 32px; /* Height of TitleBar */
        height: 100vh;
        width: 100%;
        overflow: hidden; /* Prevent body scroll if content handles it, otherwise auto */
    }
</style>
