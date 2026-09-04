<script lang="ts">
  // custom window resize handles . linux only
  //
  // we run with decorations: false in tauri.conf.json
  // for a custom frameless TitleBar
  // unlike windows/mac on linux (WebKitGTK/X11/Wayland), undecorated windows lose accurate resize handling => no resize cursor on hover
  //
  // fix: draw invisible edge/corner regions
  // call tauri's startResizeDragging on press (more reliable)

  import { onMount, onDestroy } from "svelte";
  import { isTauri, getIsLinux, initPlatformDetection } from "$lib/api/tauri";
  import type { CursorIcon } from "@tauri-apps/api/window";

  // hit zone thickness in css px
  const EDGE = 10;
  const CORNER = 18;

  let showHandles = false;
  let currentIcon: CursorIcon | "default" | null = null;

  const CURSOR_BY_DIRECTION: Record<string, CursorIcon> = {
    North: "nResize",
    South: "sResize",
    East: "eResize",
    West: "wResize",
    NorthWest: "nwResize",
    NorthEast: "neResize",
    SouthWest: "swResize",
    SouthEast: "seResize",
  };

  onMount(async () => {
    if (isTauri()) {
      await initPlatformDetection();
    }
    showHandles = isTauri() && getIsLinux();
  });

  onDestroy(() => {
    // don't leave the window stuck with a resize cursor if this unmounts mid hover
    if (currentIcon && currentIcon !== "default") {
      setCursorIcon("default");
    }
  });

  async function setCursorIcon(icon: CursorIcon | "default") {
    if (!isTauri() || currentIcon === icon) return;
    currentIcon = icon;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setCursorIcon(icon as CursorIcon);
    } catch (err) {
      console.error("Failed to set cursor icon:", err);
    }
  }

  async function startResize(direction: string) {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startResizeDragging(direction as any);
    } catch (err) {
      console.error("Failed to start window resize:", err);
    }
  }

  function onPointerEnter(direction: string) {
    setCursorIcon(CURSOR_BY_DIRECTION[direction]);
  }

  function onPointerLeaveContainer() {
    // reset only when the pointer leaves the whole overlay, not between adjacent handles
    // so the cursor doesn't flicker back to default while crossing from an edge into its neighbouring corner
    setCursorIcon("default");
  }

  function onPointerDown(e: PointerEvent, direction: string) {
    // only left click/primary pointer should initiate a resize drag
    if (e.button !== 0) return;
    e.preventDefault();
    startResize(direction);
  }
</script>

{#if showHandles}
  <div
    class="resize-handles"
    style="--edge: {EDGE}px; --corner: {CORNER}px;"
    onpointerleave={onPointerLeaveContainer}
  >
    <div
      class="edge n"
      onpointerenter={() => onPointerEnter("North")}
      onpointerdown={(e) => onPointerDown(e, "North")}
    ></div>
    <div
      class="edge s"
      onpointerenter={() => onPointerEnter("South")}
      onpointerdown={(e) => onPointerDown(e, "South")}
    ></div>
    <div
      class="edge e"
      onpointerenter={() => onPointerEnter("East")}
      onpointerdown={(e) => onPointerDown(e, "East")}
    ></div>
    <div
      class="edge w"
      onpointerenter={() => onPointerEnter("West")}
      onpointerdown={(e) => onPointerDown(e, "West")}
    ></div>

    <div
      class="corner nw"
      onpointerenter={() => onPointerEnter("NorthWest")}
      onpointerdown={(e) => onPointerDown(e, "NorthWest")}
    ></div>
    <div
      class="corner ne"
      onpointerenter={() => onPointerEnter("NorthEast")}
      onpointerdown={(e) => onPointerDown(e, "NorthEast")}
    ></div>
    <div
      class="corner sw"
      onpointerenter={() => onPointerEnter("SouthWest")}
      onpointerdown={(e) => onPointerDown(e, "SouthWest")}
    ></div>
    <div
      class="corner se"
      onpointerenter={() => onPointerEnter("SouthEast")}
      onpointerdown={(e) => onPointerDown(e, "SouthEast")}
    ></div>
  </div>
{/if}

<style>
  .resize-handles {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
  }

  .edge,
  .corner {
    position: fixed;
    pointer-events: auto;
  }

  /* edges */
  .edge.n {
    top: 0;
    left: var(--corner);
    right: var(--corner);
    height: var(--edge);
    cursor: ns-resize;
  }
  .edge.s {
    bottom: 0;
    left: var(--corner);
    right: var(--corner);
    height: var(--edge);
    cursor: ns-resize;
  }
  .edge.e {
    top: var(--corner);
    right: 0;
    bottom: var(--corner);
    width: var(--edge);
    cursor: ew-resize;
  }
  .edge.w {
    top: var(--corner);
    left: 0;
    bottom: var(--corner);
    width: var(--edge);
    cursor: ew-resize;
  }

  /* corners */
  .corner {
    width: var(--corner);
    height: var(--corner);
  }
  .corner.nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
  }
  .corner.se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
  }
  .corner.ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
  }
  .corner.sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
  }
</style>