<script lang="ts">
    import type { StatsSummary } from "$lib/api/tauri";
    import { goToArtistDetail } from "$lib/stores/view";
    import { _ } from "svelte-i18n";
    import Icon from "$lib/components/Icon.svelte";

    export let statsSummary: StatsSummary;
</script>

<section class="stats-widget-section">
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-icon">
                <Icon name="bar-chart-2" size={24} />
            </div>
            <div class="stat-info">
                <span class="stat-value">{statsSummary.total_plays}</span>
                <span class="stat-label">{$_('home.stats.plays')}</span>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon">
                <Icon name="clock" size={24} />
            </div>
            <div class="stat-info">
                <span class="stat-value">{Math.round(statsSummary.total_duration_seconds / 60)} min</span>
                <span class="stat-label">{$_('home.stats.timePlayed')}</span>
            </div>
        </div>
        {#if statsSummary.top_artist}
            <div
                class="stat-card link-card"
                on:click={() => statsSummary.top_artist && goToArtistDetail(statsSummary.top_artist)}
                role="button"
                tabindex="0"
                on:keydown={(e) => e.key === 'Enter' && statsSummary.top_artist && goToArtistDetail(statsSummary.top_artist)}
            >
                <div class="stat-icon">
                    <Icon name="star" size={24} />
                </div>
                <div class="stat-info">
                    <span class="stat-value">{statsSummary.top_artist}</span>
                    <span class="stat-label">{$_('home.stats.topArtist')}</span>
                </div>
            </div>
        {/if}
    </div>
</section>

<style>
    .stats-widget-section {
        margin-bottom: 8px;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
    }

    .stat-card {
        display: flex;
        align-items: center;
        gap: 16px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 16px 20px;
        transition: all 0.2s ease;
    }

    .stat-card:hover {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%);
        border-color: rgba(255, 255, 255, 0.1);
        transform: translateY(-2px);
    }

    .stat-card.link-card {
        cursor: pointer;
    }

    .stat-card.link-card:hover {
        border-color: var(--accent-primary, #1db954);
    }

    .stat-icon {
        font-size: 2rem;
        opacity: 0.8;
    }

    .stat-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .stat-value {
        font-size: 1.25rem;
        font-weight: 800;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .stat-label {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        font-weight: 500;
    }
</style>
