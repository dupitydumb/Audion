<script lang="ts">
    export let name: 'speaker' | 'headphone' | 'chevron-down' | 'chevron-up' | 'x' | 'check' | 'info' | 'refresh' | 'loader';
    export let size: number | string = 16;

    const sizeMap: Record<string, number> = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 };
    $: px = typeof size === 'number' ? size : (sizeMap[size as string] ?? 16);
  </script>
  
  <svg
    viewBox="0 0 16 16"
    width={px}
    height={px}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    class:spin={name === 'loader'}
  >
    {#if name === 'speaker'}
      <rect x="2" y="4" width="6" height="8" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <path d="M10.5 6a2.5 2.5 0 0 1 0 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M12.5 4a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  
    {:else if name === 'headphone'}
      <path d="M2.5 8.5V8a5.5 5.5 0 0 1 11 0v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <rect x="1.5" y="8.5" width="2.5" height="4" rx="1.25" stroke="currentColor" stroke-width="1.4"/>
      <rect x="12" y="8.5" width="2.5" height="4" rx="1.25" stroke="currentColor" stroke-width="1.4"/>
  
    {:else if name === 'chevron-down'}
      <path d="M3 5.5L8 10.5L13 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>

    {:else if name === 'chevron-up'}
      <path d="M3 10.5L8 5.5L13 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>

    {:else if name === 'x'}
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  
    {:else if name === 'check'}
      <path d="M2.5 8L6 11.5L13.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>

    {:else if name === 'info'}
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 7.5v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="8" cy="4.5" r="0.75" fill="currentColor"/>

    {:else if name === 'refresh'}
      <path d="M2.5 8a5.5 5.5 0 0 1 9.14-3.89L13.5 6M13.5 2v4h-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13.5 8a5.5 5.5 0 0 1-9.14 3.89L2.5 10M2.5 14v-4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>

    {:else if name === 'loader'}
      <path d="M8 2a6 6 0 0 1 5.2 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    {/if}
  </svg>

  <style>
    @keyframes icon-spin {
      to { transform: rotate(360deg); }
    }
    .spin {
      animation: icon-spin 0.8s linear infinite;
    }
  </style>