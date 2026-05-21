<script lang="ts">
    export let name: 'speaker' | 'headphone' | 'chevron-down' | 'check';
    export let size: number = 16;
  </script>
  
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
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
  
    {:else if name === 'check'}
      <path d="M2.5 8L6 11.5L13.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    {/if}
  </svg>