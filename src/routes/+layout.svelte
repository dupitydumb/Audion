<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { appSettings } from "$lib/stores/settings";
    import { theme } from "$lib/stores/theme";
    import { cleanupPlayer } from "$lib/stores/player";
    import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
    import TitleBar from "$lib/components/TitleBar.svelte";
    import "../app.css";

    let handleVisibilityChange: (() => void) | null = null;

    onMount(() => {
        appSettings.initialize();
        theme.initialize();
        
        // handle page visibility
        handleVisibilityChange = () => {
            if (document.hidden) {
                // Tab hidden - we could pause here if desired
                // But DON'T call cleanupPlayer() - too aggressive
            }
        };
        
        document.addEventListener('visibilitychange', handleVisibilityChange);
    });
    
    // Cleanup on component unmount
    onDestroy(() => {
        console.log('[App] Cleaning up on unmount');
        
        // Remove visibility change listener
        if (handleVisibilityChange) {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        
        // Cleanup player resources
        cleanupPlayer();
    });
    
    // Cleanup on hot reload (development only)
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            console.log('[App] Cleaning up on hot reload');
            cleanupPlayer();
        });
    }
</script>

<TitleBar />
<ConfirmDialog />
<div class="app-content">
    <slot />
</div>

<style>
    .app-content {
        padding-top: 48px; /* Height of TitleBar */
        height: 100vh;
        width: 100%;
        overflow: hidden; /* Prevent body scroll if content handles it, otherwise auto */
    }
</style>
