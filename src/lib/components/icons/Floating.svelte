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
  <rect width="6" height="2.5" x="9" y="8" rx="1.25" fill="currentColor" stroke="none" />
</svg>

