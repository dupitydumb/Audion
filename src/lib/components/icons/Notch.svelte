<script lang="ts">
  export let size: number = 24;
  export let strokeWidth: number = 2;
  export let fill: string = 'none';
  let className: string = '';
  export { className as class };
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  <rect width="18" height="14" x="3" y="5" rx="2" />
  <path d="M9 5v1.5a1.5 1.5 0 0 0 1.5 1.5h3a1.5 1.5 0 0 0 1.5-1.5V5" fill="currentColor" />
</svg>

