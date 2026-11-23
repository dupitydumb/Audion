<script lang="ts">
  export let variant: "square" | "round" = "square";
  export let animated: boolean = true;
  export let className: string = "";
</script>

<div class="skeleton-card {variant} {className}" class:animated aria-hidden="true">
  <div class="skeleton-cover {variant}">
    <div class="shimmer-wave"></div>
  </div>
  <div class="skeleton-info">
    <div class="skeleton-line title">
      <div class="shimmer-wave"></div>
    </div>
    <div class="skeleton-line subtitle">
      <div class="shimmer-wave"></div>
    </div>
  </div>
</div>

<style>
  .skeleton-card {
    display: flex;
    flex-direction: column;
    padding: var(--spacing-md);
    border-radius: var(--radius-md);
    background-color: transparent;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    user-select: none;
    pointer-events: none;
  }

  :global(html.layout-mobile) .skeleton-card {
    padding: var(--spacing-sm);
  }

  .skeleton-card.round {
    align-items: center;
    text-align: center;
  }

  .skeleton-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    margin-bottom: var(--spacing-md);
    box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.2));
    flex-shrink: 0;
  }

  :global(html.layout-mobile) .skeleton-cover {
    margin-bottom: var(--spacing-sm);
  }

  .skeleton-cover.round {
    border-radius: var(--radius-full);
    width: 140px;
    height: 140px;
    aspect-ratio: unset;
    margin-left: auto;
    margin-right: auto;
  }

  :global(html.layout-mobile) .skeleton-cover.round {
    width: 100px;
    height: 100px;
  }

  .skeleton-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .skeleton-card.round .skeleton-info {
    align-items: center;
  }

  .skeleton-line {
    position: relative;
    overflow: hidden;
    height: 14px;
    border-radius: var(--radius-sm, 4px);
    background: rgba(255, 255, 255, 0.05);
  }

  .skeleton-line.title {
    width: 75%;
    height: 15px;
  }

  .skeleton-line.subtitle {
    width: 48%;
    height: 12px;
  }

  .animated .shimmer-wave {
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.04) 30%,
      rgba(255, 255, 255, 0.12) 50%,
      rgba(255, 255, 255, 0.04) 70%,
      transparent 100%
    );
    animation: skeleton-shimmer 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes skeleton-shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
