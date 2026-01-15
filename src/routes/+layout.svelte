<script lang="ts">
    import { onMount } from "svelte";
    import { appSettings } from "$lib/stores/settings";
    import { theme } from "$lib/stores/theme";
    import "../app.css";

    onMount(() => {
        appSettings.initialize();
        theme.initialize();
    });
</script>

<slot />
