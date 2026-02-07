<script lang="ts">
    import { 
        isScanning, 
        scanProgress, 
        scanPercentage, 
        estimatedTimeRemaining,
        elapsedTime,
        tracksAdded,
        tracksUpdated
    } from '$lib/stores/progressiveScan';
    import { trackCount } from '$lib/stores/library';
    import { fade, slide } from 'svelte/transition';
    
    $: progress = $scanProgress;
    $: percentage = $scanPercentage;
    $: eta = $estimatedTimeRemaining;
    $: loaded = $trackCount;
    $: elapsed = $elapsedTime;
    $: added = $tracksAdded;
    $: updated = $tracksUpdated;
</script>

{#if $isScanning}
    <div class="scan-banner" transition:slide={{ duration: 200 }}>
        <div class="scan-content">
            <!-- Spinner Icon -->
            <div class="scan-icon">
                <div class="spinner"></div>
            </div>
            
            <!-- Scan Info -->
            <div class="scan-info">
                <div class="scan-title">
                    Scanning library...
                </div>
                <div class="scan-details">
                    {#if progress}
                        <span class="progress-text">
                            {progress.current.toLocaleString()} of {progress.total.toLocaleString()} files
                        </span>
                        {#if eta}
                            <span class="eta-separator">·</span>
                            <span class="eta-text">{eta} remaining</span>
                        {/if}
                        {#if elapsed}
                            <span class="eta-separator">·</span>
                            <span class="elapsed-text">{elapsed} elapsed</span>
                        {/if}
                    {/if}
                </div>
            </div>
            
            <!-- Stats -->
            <div class="scan-stats">
                <div class="tracks-loaded" class:pulsing={loaded > 0}>
                    ✓ {loaded.toLocaleString()} tracks ready
                </div>
                <div class="scan-counts">
                    {#if added > 0}
                        <span class="count-item added">+{added.toLocaleString()} added</span>
                    {/if}
                    {#if updated > 0}
                        <span class="count-item updated">↻ {updated.toLocaleString()} updated</span>
                    {/if}
                </div>
                {#if progress}
                    <div class="batch-info">
                        Batch #{progress.current_batch} ({progress.batch_size} tracks)
                    </div>
                {/if}
            </div>
        </div>
        
        <!-- Progress Bar -->
        {#if progress}
            <div class="progress-bar">
                <div 
                    class="progress-fill" 
                    style="width: {percentage}%"
                    transition:fade={{ duration: 150 }}
                ></div>
            </div>
        {/if}
    </div>
{/if}

<style>
    .scan-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: var(--bg-elevated);
        border-bottom: 1px solid var(--border-color);
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
    
    .scan-content {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 20px;
    }
    
    .scan-icon {
        flex-shrink: 0;
    }
    
    .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--text-subdued);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    
    .scan-info {
        flex: 1;
        min-width: 0;
    }
    
    .scan-title {
        font-weight: 600;
        color: var(--text-primary);
        font-size: 14px;
        margin-bottom: 2px;
    }
    
    .scan-details {
        font-size: 12px;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }
    
    .progress-text {
        font-weight: 500;
    }
    
    .eta-separator {
        color: var(--text-subdued);
    }
    
    .eta-text {
        color: var(--accent-primary);
        font-weight: 500;
    }
    
    .elapsed-text {
        color: var(--text-subdued);
    }
    
    .scan-stats {
        flex-shrink: 0;
        text-align: right;
    }
    
    .tracks-loaded {
        font-size: 13px;
        color: var(--accent-primary);
        font-weight: 600;
        margin-bottom: 2px;
    }
    
    .tracks-loaded.pulsing {
        animation: pulse 2s ease-in-out infinite;
    }
    
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }
    
    .batch-info {
        font-size: 11px;
        color: var(--text-subdued);
    }

        .scan-counts {
        display: flex;
        gap: 8px;
        font-size: 11px;
        margin-bottom: 2px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .count-item {
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: 500;
    }

    .count-item.added {
        color: var(--success-text, #1ed760);
        background: var(--success-bg, rgba(30, 215, 96, 0.1));
    }

    .count-item.updated {
        color: var(--info-text, #3b82f6);
        background: var(--info-bg, rgba(59, 130, 246, 0.1));
    }

    /* Responsive - hide counts on very small screens */
    @media (max-width: 480px) {
        .scan-counts {
            display: none;
        }
    }
    
    .progress-bar {
        height: 3px;
        background: var(--bg-base);
        overflow: hidden;
    }
    
    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-primary), var(--accent-light, #1ed760));
        transition: width 0.3s ease;
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
        .scan-content {
            padding: 10px 16px;
            gap: 12px;
        }
        
        .scan-title {
            font-size: 13px;
        }
        
        .scan-details {
            font-size: 11px;
        }
        
        .batch-info {
            display: none;
        }
    }
    
    @media (max-width: 480px) {
        .elapsed-text {
            display: none;
        }
        
        .tracks-loaded {
            font-size: 12px;
        }
    }
</style>