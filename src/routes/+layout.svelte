<script lang="ts">
    import { onMount } from "svelte";
    import { appSettings } from "$lib/stores/settings";
    import { theme } from "$lib/stores/theme";
    import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
    import "../app.css";

    onMount(() => {
        appSettings.initialize();
        theme.initialize();
    });
</script>

<ConfirmDialog />
<slot />
