<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { fade, scale } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";
  import {
    theme,
    exportSkinPackage,
    parseSkinPackage,
    type SkinScheme,
    type ThemeMode,
    type CustomColors,
    darkDefaults,
    lightDefaults,
    isSkinStudioOpen,
    closeSkinStudio,
  } from "$lib/stores/theme";
  import { applySkinCss } from "$lib/services/skin-css";
  import { isTauri } from "$lib/api/tauri";
  import { _ } from "svelte-i18n";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  $: isOpen = open || $isSkinStudioOpen;

  type TabId = "css" | "schemes" | "effect" | "package";
  let activeTab: TabId = "css";

  // Window view mode: modal (centered), docked (floating side panel), or popout (separate OS window)
  type StudioViewMode = "modal" | "docked" | "popout";
  let viewMode: StudioViewMode = "modal";
  let modalEl: HTMLElement | null = null;
  let modalPlaceholderEl: HTMLElement | null = null;
  let pipWindow: any = null;
  let isPoppedOut = false;
  let isPipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  // Working state (isolated from store until saved, or previewed live)
  let livePreview = true;
  let skinName = "My Custom Skin";
  let skinAuthor = "";
  let skinDescription = "";
  let customCss = "";
  let customJs = "";
  let allowCustomJs = false;

  let schemes: Record<string, SkinScheme> = {};
  let activeSchemeName = "Default";
  let newSchemeInput = "";

  let originalCss = "";
  let originalJs = "";
  let originalAllowJs = false;

  function initFromStore() {
    const curTheme = get(theme);
    skinName = curTheme.skinName || "My Custom Skin";
    skinAuthor = curTheme.skinAuthor || "";
    skinDescription = curTheme.skinDescription || "";
    customCss = curTheme.customCss || "";
    customJs = curTheme.customJs || "";
    allowCustomJs = curTheme.allowCustomJs;
    originalCss = customCss;
    originalJs = customJs;
    originalAllowJs = allowCustomJs;

    if (curTheme.schemes && Object.keys(curTheme.schemes).length > 0) {
      schemes = JSON.parse(JSON.stringify(curTheme.schemes));
      activeSchemeName = curTheme.activeScheme || Object.keys(schemes)[0];
    } else {
      schemes = {
        Default: {
          name: "Default",
          mode: curTheme.mode,
          accentColor: curTheme.accentColor,
          customColors: JSON.parse(JSON.stringify(curTheme.customColors)),
        },
      };
      activeSchemeName = "Default";
    }
  }

  let wasOpen = false;
  $: if (isOpen && !wasOpen) {
    wasOpen = true;
    initFromStore();
    requestAnimationFrame(() => {
      if (modalEl) {
        const activeTabBtn = modalEl.querySelector<HTMLElement>(".tab-btn.active") || modalEl;
        activeTabBtn.focus();
      }
    });
  } else if (!isOpen && wasOpen) {
    wasOpen = false;
  }

  function safeHex(val?: string | null): string {
    if (!val || typeof val !== "string") return "#1db954";
    if (val.startsWith("#") && val.length >= 7) return val.slice(0, 7);
    return "#1db954";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
      return;
    }

    if (viewMode === "modal" && modalEl && e.key === "Tab") {
      const focusable = modalEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !modalEl.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (viewMode === "docked" || isPoppedOut) return;
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }

  function toggleDockMode() {
    if (viewMode === "docked") {
      viewMode = "modal";
    } else {
      if (isPoppedOut) {
        closePopout();
      }
      viewMode = "docked";
    }
  }

  function copyStylesToPip(pip: any) {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      pip.document.head.appendChild(node.cloneNode(true));
    });

    pip.document.documentElement.className = document.documentElement.className;
    pip.document.documentElement.style.cssText = document.documentElement.style.cssText;

    const docObserver = new MutationObserver(() => {
      pip.document.documentElement.className = document.documentElement.className;
      pip.document.documentElement.style.cssText = document.documentElement.style.cssText;
    });
    docObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });

    const headObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of Array.from(m.addedNodes)) {
          if (
            added.nodeName === "STYLE" ||
            (added.nodeName === "LINK" && (added as HTMLLinkElement).rel === "stylesheet")
          ) {
            const existingId = (added as HTMLElement).id;
            if (existingId) {
              const old = pip.document.getElementById(existingId);
              if (old) old.remove();
            }
            pip.document.head.appendChild(added.cloneNode(true));
          }
        }
      }
    });
    headObserver.observe(document.head, { childList: true, subtree: true });

    pip.addEventListener("pagehide", () => {
      docObserver.disconnect();
      headObserver.disconnect();
    });
  }

  async function togglePopout() {
    if (isPoppedOut) {
      closePopout();
      return;
    }

    if (isPipSupported && modalEl) {
      try {
        const pip = await (window as any).documentPictureInPicture.requestWindow({
          width: 600,
          height: 820,
        });
        pipWindow = pip;

        copyStylesToPip(pip);

        if (!modalPlaceholderEl) {
          modalPlaceholderEl = document.createElement("div");
          modalPlaceholderEl.className = "studio-placeholder";
        }
        modalEl.parentNode?.insertBefore(modalPlaceholderEl, modalEl);

        pip.document.body.style.margin = "0";
        pip.document.body.style.background = "var(--bg-base, #121212)";
        pip.document.body.style.color = "var(--text-primary, #fff)";
        pip.document.body.style.overflow = "hidden";
        pip.document.body.style.display = "flex";
        pip.document.body.style.flexDirection = "column";
        pip.document.body.style.height = "100vh";
        pip.document.body.appendChild(modalEl);

        isPoppedOut = true;
        viewMode = "popout";

        pip.addEventListener("pagehide", () => {
          returnFromPip();
        });
        return;
      } catch (err) {
        console.warn("[SkinStudio] Picture-in-picture failed, falling back to docked mode:", err);
      }
    }

    // Fallback: switch to docked mode
    viewMode = viewMode === "docked" ? "modal" : "docked";
  }

  function returnFromPip() {
    if (modalEl && modalPlaceholderEl && modalPlaceholderEl.parentNode) {
      modalPlaceholderEl.parentNode.insertBefore(modalEl, modalPlaceholderEl);
      modalPlaceholderEl.remove();
      modalPlaceholderEl = null;
    }
    pipWindow = null;
    isPoppedOut = false;
    viewMode = "docked";
  }

  function closePopout() {
    if (pipWindow) {
      try {
        pipWindow.close();
      } catch {}
      pipWindow = null;
    }
    returnFromPip();
  }

  onDestroy(() => {
    if (pipWindow) {
      try {
        pipWindow.close();
      } catch {}
      pipWindow = null;
    }
  });

  $: currentScheme = schemes[activeSchemeName] || {
    name: "Default",
    mode: "dark",
    accentColor: "#1DB954",
    customColors: { ...darkDefaults },
  };

  const colorTokenKeys: { key: keyof CustomColors; label: string }[] = [
    { key: "bgBase", label: "Base background" },
    { key: "bgElevated", label: "Elevated background" },
    { key: "bgSurface", label: "Surface / cards" },
    { key: "bgHighlight", label: "Highlight / hover" },
    { key: "sidebarBg", label: "Sidebar background" },
    { key: "playerBg", label: "Player bar background" },
    { key: "textPrimary", label: "Primary text" },
    { key: "textSecondary", label: "Secondary text" },
    { key: "textSubdued", label: "Subdued text" },
    { key: "borderColor", label: "Border color" },
  ];

  function onCssInput() {
    if (livePreview) {
      applySkinCss(customCss);
    }
  }

  function toggleLivePreview() {
    livePreview = !livePreview;
    if (livePreview) {
      applySkinCss(customCss);
    } else {
      applySkinCss($theme.customCss);
    }
  }

  function addScheme() {
    const trimmed = newSchemeInput.trim();
    if (!trimmed || schemes[trimmed]) return;
    schemes[trimmed] = {
      name: trimmed,
      mode: currentScheme.mode,
      accentColor: currentScheme.accentColor,
      customColors: JSON.parse(JSON.stringify(currentScheme.customColors)),
    };
    schemes = { ...schemes };
    activeSchemeName = trimmed;
    newSchemeInput = "";
  }

  function deleteScheme(name: string) {
    if (Object.keys(schemes).length <= 1) return;
    delete schemes[name];
    schemes = { ...schemes };
    if (activeSchemeName === name) {
      activeSchemeName = Object.keys(schemes)[0];
    }
  }

  function setSchemeMode(mode: ThemeMode) {
    if (!schemes[activeSchemeName]) return;
    schemes[activeSchemeName].mode = mode;
    schemes = { ...schemes };
  }

  function setSchemeAccent(color: string) {
    if (!schemes[activeSchemeName]) return;
    schemes[activeSchemeName].accentColor = color;
    schemes = { ...schemes };
  }

  function setSchemeToken(key: keyof CustomColors, value: string | null) {
    if (!schemes[activeSchemeName]) return;
    schemes[activeSchemeName].customColors[key] = value;
    schemes = { ...schemes };
  }

  const cssSnippets = [
    {
      name: "Glassmorphism Player Bar",
      code: `/* Glassmorphism Player Bar */
.player-bar {
  background: rgba(18, 18, 18, 0.75) !important;
  backdrop-filter: blur(16px) saturate(160%);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.35);
}
`,
    },
    {
      name: "Pill Controls & Soft Cards",
      code: `/* Pill Buttons & Soft Rounded Cards */
.play-btn {
  border-radius: 9999px !important;
}
.album-card, .track-row {
  border-radius: 12px !important;
  transition: transform 180ms ease, box-shadow 180ms ease !important;
}
.album-card:hover {
  transform: translateY(-3px) scale(1.02);
}
`,
    },
    {
      name: "Subtle Sidebar Glow",
      code: `/* Subtle Sidebar Border Glow */
.sidebar {
  border-right: 1px solid rgba(var(--accent-primary-rgb, 29, 185, 84), 0.25) !important;
  box-shadow: 2px 0 16px rgba(0, 0, 0, 0.2);
}
`,
    },
    {
      name: "Modern Rounded Window Controls",
      code: `/* Modern Custom Radius */
:root {
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
}
.album-art, .album-art-placeholder {
  border-radius: 10px !important;
  overflow: hidden;
}
`,
    },
  ];

  function insertCssSnippet(snippet: string) {
    customCss = (customCss.trim() ? customCss + "\n\n" : "") + snippet;
    onCssInput();
  }

  const jsSnippets = [
    {
      name: "Aurora Borealis Glow",
      code: `let animId;
let t = 0;
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  t += 0.008;
  const w = canvas.width;
  const h = canvas.height * 0.45;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(136, 192, 208, 0.08)');
  grad.addColorStop(0.5, 'rgba(143, 188, 187, 0.12)');
  grad.addColorStop(1, 'rgba(129, 161, 193, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= w; x += 30) {
    const y = Math.sin(x * 0.004 + t) * 35 + Math.cos(x * 0.002 - t * 0.8) * 25 + 70;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fill();
  animId = requestAnimationFrame(render);
}
render();
return () => cancelAnimationFrame(animId);`,
    },
    {
      name: "Falling Snow / Particles",
      code: `const particles = Array.from({ length: 45 }, () => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
  r: Math.random() * 2 + 1,
  v: Math.random() * 0.8 + 0.4
}));
let animId;
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (const p of particles) {
    p.y += p.v;
    if (p.y > canvas.height) p.y = -5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  animId = requestAnimationFrame(draw);
}
draw();
return () => cancelAnimationFrame(animId);`,
    },
  ];

  function insertJsSnippet(code: string) {
    customJs = code;
    allowCustomJs = true;
  }

  function saveAndApply() {
    const active = schemes[activeSchemeName] || currentScheme;
    theme.applyPackage({
      skinName,
      skinAuthor,
      skinDescription,
      mode: active.mode,
      accentColor: active.accentColor,
      customColors: active.customColors,
      customCss,
      customJs,
      schemes,
      activeScheme: activeSchemeName,
    });
    if (allowCustomJs) {
      theme.setAllowCustomJs(true);
    }
    if (isPoppedOut) {
      closePopout();
    }
    open = false;
    closeSkinStudio();
    dispatch("close");
  }

  function handleCancel() {
    applySkinCss(originalCss);
    if (isPoppedOut) {
      closePopout();
    }
    open = false;
    closeSkinStudio();
    dispatch("close");
  }

  async function handleExportSkin() {
    const active = schemes[activeSchemeName] || currentScheme;
    const pkg = exportSkinPackage(
      {
        ...$theme,
        skinName,
        skinAuthor,
        skinDescription,
        mode: active.mode,
        accentColor: active.accentColor,
        customColors: active.customColors,
        customCss,
        customJs,
        schemes,
        activeScheme: activeSchemeName,
      },
      skinName,
      skinAuthor,
      skinDescription
    );

    const json = JSON.stringify(pkg, null, 2);
    const fileName = (skinName.trim().replace(/[^a-z0-9_-]/gi, "_").toLowerCase() || "skin") + ".audionskin";

    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({
          defaultPath: fileName,
          filters: [
            { name: "Audion Skin", extensions: ["audionskin", "audiotheme"] },
            { name: "JSON", extensions: ["json"] },
          ],
        });
        if (!path) return;
        await writeTextFile(path, json);
      } catch (e) {
        console.error("[SkinStudio] Export error:", e);
      }
    } else {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function handleImportSkin() {
    if (isTauri()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const selected = await open({
          filters: [
            { name: "Audion Skin & Theme", extensions: ["audionskin", "audiotheme", "json"] },
          ],
          multiple: false,
        });
        if (!selected) return;
        const filePath = typeof selected === "string" ? selected : selected[0];
        const text = await readTextFile(filePath);
        loadImportedText(text);
      } catch (e) {
        console.error("[SkinStudio] Import error:", e);
      }
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".audionskin,.audiotheme,application/json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        loadImportedText(await file.text());
      };
      input.click();
    }
  }

  function loadImportedText(text: string) {
    try {
      const raw = JSON.parse(text);
      const pkg = parseSkinPackage(raw);
      skinName = pkg.name;
      skinAuthor = pkg.author || "";
      skinDescription = pkg.description || "";
      customCss = pkg.customCss || "";
      customJs = pkg.customJs || "";
      if (pkg.schemes && Object.keys(pkg.schemes).length > 0) {
        schemes = pkg.schemes;
        activeSchemeName = pkg.activeScheme || Object.keys(pkg.schemes)[0];
      } else {
        schemes = {
          Default: {
            name: "Default",
            mode: pkg.mode || "dark",
            accentColor: pkg.accentColor,
            customColors: pkg.customColors,
          },
        };
        activeSchemeName = "Default";
      }
      onCssInput();
    } catch (e) {
      console.error("[SkinStudio] Failed to parse skin:", e);
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    class:docked={viewMode === 'docked'}
    class:popped-out={isPoppedOut}
    transition:fade={{ duration: 180 }}
    on:click={handleBackdropClick}
  >
    <div
      bind:this={modalEl}
      class="studio-modal"
      class:docked={viewMode === 'docked'}
      role="dialog"
      aria-modal={viewMode === 'modal'}
      aria-labelledby="skin-studio-title"
      tabindex="-1"
      transition:scale={{ duration: 220, start: 0.96 }}
    >
      <div class="studio-header">
        <div class="studio-title-wrap">
          <div class="studio-header-icon" aria-hidden="true">
            <Icon name="palette" size={20} />
          </div>
          <div>
            <h2 id="skin-studio-title" class="studio-title">Skin Studio</h2>
            <p class="studio-subtitle">Author, edit, and style Audion skins with custom CSS & schemes</p>
          </div>
        </div>

        <div class="header-actions">
          {#if !isPoppedOut}
            <button
              type="button"
              class="header-action-btn"
              class:active={viewMode === 'docked'}
              on:click={toggleDockMode}
              title={viewMode === 'docked' ? 'Center Modal' : 'Dock to Side (keeps Audion interactive)'}
              aria-label={viewMode === 'docked' ? 'Center modal' : 'Dock to side'}
            >
              <Icon name={viewMode === 'docked' ? 'maximize' : 'minimize'} size={15} />
            </button>
          {/if}

          <button
            type="button"
            class="header-action-btn"
            class:active={isPoppedOut}
            on:click={togglePopout}
            title={isPoppedOut ? 'Return to App' : 'Pop out to separate window'}
            aria-label={isPoppedOut ? 'Return to main window' : 'Pop out into separate window'}
          >
            <Icon name="external-link" size={15} />
          </button>

          <button
            type="button"
            class="close-btn"
            on:click={handleCancel}
            title="Close (Esc)"
            aria-label="Close Skin Studio"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      <div class="studio-tabs" role="tablist" aria-label="Skin Studio sections">
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'css'}
          role="tab"
          aria-selected={activeTab === 'css'}
          on:click={() => (activeTab = 'css')}
        >
          <Icon name="file-text" size={15} />
          <span>Styles (user.css)</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'schemes'}
          role="tab"
          aria-selected={activeTab === 'schemes'}
          on:click={() => (activeTab = 'schemes')}
        >
          <Icon name="sliders" size={15} />
          <span>Color Schemes</span>
          <span class="badge-count">{Object.keys(schemes).length}</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'effect'}
          role="tab"
          aria-selected={activeTab === 'effect'}
          on:click={() => (activeTab = 'effect')}
        >
          <Icon name="zap" size={15} />
          <span>Canvas Effect (effect.js)</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'package'}
          role="tab"
          aria-selected={activeTab === 'package'}
          on:click={() => (activeTab = 'package')}
        >
          <Icon name="download" size={15} />
          <span>Package & Export</span>
        </button>
      </div>

      <div class="studio-body">
        {#if activeTab === 'css'}
          <div class="tab-pane" role="tabpanel" aria-label="Styles">
            <div class="pane-toolbar">
              <span class="pane-hint">
                Write standard CSS to style any Audion element. Custom styles inject live.
              </span>
              <div class="preview-toggle-wrap">
                <label class="toggle-label">
                  <input type="checkbox" checked={livePreview} on:change={toggleLivePreview} />
                  <span>Live Preview</span>
                </label>
              </div>
            </div>

            <div class="snippet-chips">
              <span class="snippet-label">Quick Snippets:</span>
              {#each cssSnippets as s}
                <button
                  type="button"
                  class="snippet-chip"
                  on:click={() => insertCssSnippet(s.code)}
                >
                  <Icon name="plus" size={11} />
                  {s.name}
                </button>
              {/each}
            </div>

            <textarea
              class="code-editor"
              bind:value={customCss}
              on:input={onCssInput}
              placeholder="/* Enter custom CSS rules here (e.g. .player-bar, .sidebar, .album-art) */"
              aria-label="Custom CSS editor"
              spellcheck="false"
            ></textarea>

            <div class="vars-cheatsheet">
              <span class="sheet-title">Useful CSS Tokens:</span>
              <div class="sheet-tokens">
                <code>--skin-accent</code>
                <code>--skin-bg-base</code>
                <code>--skin-bg-surface</code>
                <code>--skin-bg-elevated</code>
                <code>--skin-text-primary</code>
                <code>--skin-text-secondary</code>
                <code>--skin-border</code>
                <code>--skin-player-bg</code>
                <code>--skin-sidebar-bg</code>
              </div>
            </div>
          </div>

        {:else if activeTab === 'schemes'}
          <div class="tab-pane" role="tabpanel" aria-label="Color Schemes">
            <div class="scheme-bar">
              <div class="scheme-selector-group">
                <label for="active-scheme-select" class="scheme-bar-label">Current Scheme:</label>
                <select id="active-scheme-select" class="scheme-select" bind:value={activeSchemeName} aria-label="Current color scheme">
                  {#each Object.keys(schemes) as name}
                    <option value={name}>{name}</option>
                  {/each}
                </select>
                {#if Object.keys(schemes).length > 1}
                  <button
                    class="btn-icon-danger"
                    title="Delete Scheme"
                    aria-label="Delete active scheme"
                    on:click={() => deleteScheme(activeSchemeName)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                {/if}
              </div>

              <div class="scheme-add-group">
                <input
                  type="text"
                  class="scheme-input"
                  bind:value={newSchemeInput}
                  placeholder="New scheme name (e.g. OLED, Light)"
                  aria-label="New color scheme name"
                  maxlength="32"
                />
                <button class="btn-sm" on:click={addScheme} disabled={!newSchemeInput.trim()}>
                  <Icon name="plus" size={13} />
                  Add Scheme
                </button>
              </div>
            </div>

            <div class="scheme-mode-row">
              <span class="token-label">Mode Default:</span>
              <div class="mode-toggles">
                <button
                  type="button"
                  class="mode-btn"
                  class:selected={currentScheme.mode === 'dark'}
                  on:click={() => setSchemeMode('dark')}
                >
                  Dark
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  class:selected={currentScheme.mode === 'light'}
                  on:click={() => setSchemeMode('light')}
                >
                  Light
                </button>
              </div>

              <div class="accent-picker-inline">
                <span class="token-label">Accent Color:</span>
                <input
                  type="color"
                  value={safeHex(currentScheme.accentColor)}
                  aria-label="Scheme accent color"
                  on:input={(e) => setSchemeAccent((e.target as HTMLInputElement).value)}
                />
                <span class="hex-text">{currentScheme.accentColor}</span>
              </div>
            </div>

            <div class="token-grid">
              {#each colorTokenKeys as { key, label }}
                {@const val = currentScheme.customColors[key] ?? (currentScheme.mode === 'light' ? lightDefaults[key] : darkDefaults[key])}
                <div class="token-cell">
                  <div class="token-info">
                    <span class="token-name">{label}</span>
                    <span class="token-sub"><code>{key}</code></span>
                  </div>
                  <div class="token-controls">
                    <input
                      type="color"
                      value={safeHex(val)}
                      aria-label={`${label} color picker`}
                      on:input={(e) => setSchemeToken(key, (e.target as HTMLInputElement).value)}
                    />
                    <input
                      type="text"
                      class="token-hex-input"
                      value={val}
                      aria-label={`${label} hex value`}
                      on:change={(e) => setSchemeToken(key, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                </div>
              {/each}
            </div>
          </div>

        {:else if activeTab === 'effect'}
          <div class="tab-pane" role="tabpanel" aria-label="Canvas Effect">
            <div class="pane-toolbar">
              <label class="toggle-label">
                <input type="checkbox" bind:checked={allowCustomJs} />
                <span>Enable Canvas JavaScript Overlay Effect</span>
              </label>

              <div class="snippet-chips">
                <span class="snippet-label">Effect Templates:</span>
                {#each jsSnippets as s}
                  <button
                    type="button"
                    class="snippet-chip"
                    on:click={() => insertJsSnippet(s.code)}
                  >
                    <Icon name="zap" size={11} />
                    {s.name}
                  </button>
                {/each}
              </div>
            </div>

            <textarea
              class="code-editor js-editor"
              bind:value={customJs}
              placeholder="/* JavaScript canvas animation script. Receives (canvas, ctx, accent). Must return cleanup () => void */"
              aria-label="Canvas JavaScript animation effect code"
              spellcheck="false"
            ></textarea>
            <p class="field-hint">
              The script runs on the full-window <code>#audion-effect-layer</code> canvas. Return a cleanup function cancelling <code>requestAnimationFrame</code>.
            </p>
          </div>

        {:else if activeTab === 'package'}
          <div class="tab-pane pkg-tab" role="tabpanel" aria-label="Package and Export">
            <div class="form-group">
              <label class="field-label" for="skin-meta-name">Skin Name</label>
              <input
                id="skin-meta-name"
                class="form-input"
                type="text"
                bind:value={skinName}
                placeholder="e.g. Cyberpunk Violet"
                maxlength="64"
              />
            </div>

            <div class="form-group">
              <label class="field-label" for="skin-meta-author">Author</label>
              <input
                id="skin-meta-author"
                class="form-input"
                type="text"
                bind:value={skinAuthor}
                placeholder="e.g. Your Name or GitHub handle"
                maxlength="64"
              />
            </div>

            <div class="form-group">
              <label class="field-label" for="skin-meta-desc">Description</label>
              <textarea
                id="skin-meta-desc"
                class="form-textarea"
                bind:value={skinDescription}
                placeholder="Describe this skin, visual aesthetic, or features..."
                rows="3"
                maxlength="200"
              ></textarea>
            </div>

            <div class="pkg-stats-box">
              <div class="stat-item">
                <span class="stat-num">{Object.keys(schemes).length}</span>
                <span class="stat-lbl">Color Schemes</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">{customCss.trim() ? customCss.split('\n').length : 0}</span>
                <span class="stat-lbl">CSS Lines</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">{customJs.trim() ? 'Yes' : 'No'}</span>
                <span class="stat-lbl">Canvas Effect</span>
              </div>
            </div>

            <div class="pkg-buttons">
              <button type="button" class="btn-primary" on:click={handleExportSkin}>
                <Icon name="download" size={16} />
                Export Skin File (.audionskin)
              </button>
              <button type="button" class="btn-secondary" on:click={handleImportSkin}>
                <Icon name="upload" size={16} />
                Import Existing (.audionskin / .audiotheme)
              </button>
            </div>
          </div>
        {/if}
      </div>

      <div class="studio-footer">
        <button type="button" class="btn-secondary" on:click={handleCancel}>Cancel</button>
        <button type="button" class="btn-primary" on:click={saveAndApply}>
          <Icon name="check" size={15} />
          Save & Apply Skin
        </button>
      </div>
    </div>
  </div>
{/if}

{#if isOpen && isPoppedOut}
  <div class="pip-dock-pill" transition:fade={{ duration: 160 }}>
    <div class="pip-icon-wrap" aria-hidden="true">
      <Icon name="palette" size={16} />
    </div>
    <div class="pip-text-wrap">
      <span class="pip-title">Skin Studio</span>
      <span class="pip-subtitle">Active in separate window</span>
    </div>
    <button type="button" class="btn-return" on:click={closePopout}>
      <Icon name="minimize" size={13} />
      Return to App
    </button>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10005;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: auto;
    transition: background 200ms ease;
  }

  @media (max-width: 640px) {
    .modal-backdrop {
      padding: 8px;
    }
  }

  .modal-backdrop.docked {
    background: transparent !important;
    pointer-events: none !important;
    align-items: stretch;
    justify-content: flex-end;
    padding: 0;
  }

  .modal-backdrop.popped-out {
    display: none !important;
  }

  .studio-modal {
    background: var(--bg-elevated, #181818);
    border: 1px solid var(--border-color, #333);
    border-radius: 12px;
    width: 100%;
    max-width: 860px;
    height: 82vh;
    max-height: 800px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    position: relative;
    z-index: 1;
    pointer-events: auto;
    transition: all 220ms ease;
  }

  .studio-modal.docked {
    position: fixed;
    right: 16px;
    top: 56px;
    bottom: 96px;
    width: 520px;
    max-width: calc(100vw - 32px);
    height: auto;
    max-height: none;
    pointer-events: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--border-color, #333);
    border-radius: 12px;
    z-index: 10005;
  }

  @media (max-width: 768px) {
    .studio-modal.docked {
      right: 0;
      left: 0;
      top: 48px;
      bottom: 60px;
      width: 100%;
      max-width: 100%;
      border-radius: 0;
    }
  }

  :global(body > .studio-modal) {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    border-radius: 0 !important;
    border: none !important;
    box-shadow: none !important;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-action-btn {
    background: transparent;
    border: none;
    color: var(--text-subdued, #9e9e9e);
    cursor: pointer;
    padding: 7px;
    min-width: 36px;
    min-height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease, color 150ms ease;
    user-select: none;
    -webkit-user-select: none;
  }

  .header-action-btn:hover {
    background: var(--bg-surface, #282828);
    color: var(--text-primary, #fff);
  }

  .header-action-btn.active {
    background: var(--accent-subtle, rgba(29, 185, 84, 0.18));
    color: var(--accent-primary, #1db954);
  }

  .pip-dock-pill {
    position: fixed;
    bottom: 100px;
    right: 24px;
    z-index: 10006;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: var(--bg-elevated, #1c1c1c);
    border: 1px solid var(--accent-primary, #1db954);
    border-radius: 12px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
    color: var(--text-primary, #fff);
    font-size: 0.85rem;
    pointer-events: auto;
  }

  .pip-icon-wrap {
    color: var(--accent-primary, #1db954);
    display: flex;
    align-items: center;
  }

  .pip-text-wrap {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .pip-title {
    font-weight: 600;
    font-size: 0.85rem;
    line-height: 1.1;
  }

  .pip-subtitle {
    font-size: 0.72rem;
    color: var(--text-subdued, #9e9e9e);
  }

  .btn-return {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 8px;
    background: var(--accent-primary, #1db954);
    color: var(--text-on-accent, #fff);
    border: none;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms ease;
  }

  .btn-return:hover {
    background: var(--accent-hover, #1ed760);
  }

  .studio-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #282828);
  }

  .studio-title-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .studio-header-icon {
    width: 24px;
    height: 24px;
    color: var(--accent-primary, #1db954);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .studio-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-primary, #fff);
  }

  .studio-subtitle {
    margin: 2px 0 0;
    font-size: 0.8rem;
    color: var(--text-subdued, #9e9e9e);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-subdued, #9e9e9e);
    cursor: pointer;
    padding: 8px;
    min-width: 36px;
    min-height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease, color 150ms ease;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
  }

  .close-btn:hover {
    background: var(--bg-surface, #282828);
    color: var(--text-primary, #fff);
  }

  .studio-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-color, #282828);
    background: var(--bg-base, #121212);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
  }

  .studio-tabs::-webkit-scrollbar {
    display: none;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #bbb);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 160ms ease;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tab-btn:hover {
    background: var(--bg-surface, #282828);
    color: var(--text-primary, #fff);
  }

  .tab-btn.active {
    background: var(--bg-surface, #282828);
    color: var(--accent-primary, #1db954);
    font-weight: 600;
  }

  .badge-count {
    background: var(--accent-subtle, rgba(29, 185, 84, 0.2));
    color: var(--accent-primary, #1db954);
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 6px;
  }

  .studio-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
  }

  .tab-pane {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
  }

  .pane-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .pane-hint {
    font-size: 0.82rem;
    color: var(--text-subdued, #9e9e9e);
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text-secondary, #ccc);
    cursor: pointer;
  }

  .snippet-chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .snippet-label {
    font-size: 0.78rem;
    color: var(--text-subdued, #9e9e9e);
  }

  .snippet-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.78rem;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--bg-surface, #282828);
    border: 1px solid var(--border-color, #383838);
    color: var(--text-secondary, #ccc);
    cursor: pointer;
    transition: all 140ms ease;
  }

  .snippet-chip:hover {
    border-color: var(--accent-primary, #1db954);
    color: var(--text-primary, #fff);
  }

  .code-editor {
    flex: 1;
    min-height: 280px;
    background: var(--bg-surface, #141414);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 14px;
    color: var(--text-primary, #e0e0e0);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.85rem;
    line-height: 1.55;
    resize: none;
  }

  .code-editor:focus {
    border-color: var(--accent-primary, #1db954);
  }

  .vars-cheatsheet {
    background: var(--bg-surface, #222);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sheet-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-subdued, #9e9e9e);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sheet-tokens {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .sheet-tokens code {
    font-size: 0.76rem;
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--accent-hover, #1ed760);
  }

  .scheme-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px;
    background: var(--bg-surface, #222);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    flex-wrap: wrap;
  }

  .scheme-selector-group, .scheme-add-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .scheme-bar-label {
    font-size: 0.85rem;
    color: var(--text-secondary, #ccc);
  }

  .scheme-select, .scheme-input {
    background: var(--bg-base, #121212);
    border: 1px solid var(--border-color, #444);
    border-radius: 6px;
    color: var(--text-primary, #fff);
    padding: 6px 10px;
    font-size: 0.85rem;
  }

  .btn-icon-danger {
    background: transparent;
    border: none;
    color: #e57373;
    padding: 6px;
    min-width: 32px;
    min-height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-icon-danger:hover {
    background: rgba(229, 115, 115, 0.15);
  }

  .scheme-mode-row {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 8px 4px;
    flex-wrap: wrap;
  }

  .mode-toggles {
    display: flex;
    gap: 4px;
    background: var(--bg-surface, #222);
    padding: 3px;
    border-radius: 8px;
  }

  .mode-btn {
    border: none;
    background: transparent;
    color: var(--text-subdued, #9e9e9e);
    font-size: 0.8rem;
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
  }

  .mode-btn.selected {
    background: var(--bg-base, #121212);
    color: var(--text-primary, #fff);
    font-weight: 600;
  }

  .accent-picker-inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .accent-picker-inline input[type="color"] {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: transparent;
  }

  .hex-text {
    font-size: 0.8rem;
    color: var(--text-subdued, #9e9e9e);
    font-family: monospace;
  }

  .token-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
    margin-top: 8px;
  }

  .token-cell {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-surface, #222);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 10px 12px;
  }

  .token-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .token-name {
    font-size: 0.82rem;
    color: var(--text-primary, #fff);
  }

  .token-sub code {
    font-size: 0.72rem;
    color: var(--text-subdued, #9e9e9e);
  }

  .token-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .token-controls input[type="color"] {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
  }

  .token-hex-input {
    width: 78px;
    background: var(--bg-base, #121212);
    border: 1px solid var(--border-color, #444);
    border-radius: 4px;
    color: var(--text-primary, #fff);
    padding: 3px 6px;
    font-size: 0.75rem;
    font-family: monospace;
  }

  .pkg-tab {
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-secondary, #ccc);
  }

  .form-input, .form-textarea {
    background: var(--bg-surface, #222);
    border: 1px solid var(--border-color, #383838);
    border-radius: 8px;
    color: var(--text-primary, #fff);
    padding: 10px 12px;
    font-size: 0.9rem;
  }

  .form-input:focus, .form-textarea:focus {
    border-color: var(--accent-primary, #1db954);
  }

  .pkg-stats-box {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    background: var(--bg-surface, #222);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 14px;
    text-align: center;
    margin: 8px 0;
  }

  .stat-num {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--accent-primary, #1db954);
    display: block;
  }

  .stat-lbl {
    font-size: 0.75rem;
    color: var(--text-subdued, #9e9e9e);
  }

  .pkg-buttons {
    display: flex;
    gap: 12px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .studio-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 14px 20px;
    border-top: 1px solid var(--border-color, #282828);
    background: var(--bg-base, #121212);
  }

  .btn-primary, .btn-secondary, .btn-sm {
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 160ms ease;
    border: none;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
  }

  .btn-primary {
    background: var(--accent-primary, #1db954);
    color: var(--text-on-accent, #fff);
    padding: 9px 18px;
  }

  .btn-primary:hover {
    background: var(--accent-hover, #1ed760);
  }

  .btn-secondary {
    background: var(--bg-surface, #282828);
    color: var(--text-primary, #fff);
    padding: 9px 18px;
    border: 1px solid var(--border-color, #444);
  }

  .btn-secondary:hover {
    background: var(--bg-highlight, #383838);
  }

  .btn-sm {
    background: var(--bg-surface, #282828);
    color: var(--text-primary, #fff);
    padding: 6px 12px;
    border: 1px solid var(--border-color, #444);
  }

  .btn-sm:hover:not(:disabled) {
    border-color: var(--accent-primary, #1db954);
  }

  .btn-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .field-hint {
    font-size: 0.78rem;
    color: var(--text-subdued, #9e9e9e);
    margin: 4px 0 0;
  }

  /* Keyboard focus-visible rings (R-32) */
  .tab-btn:focus-visible,
  .header-action-btn:focus-visible,
  .close-btn:focus-visible,
  .btn-primary:focus-visible,
  .btn-secondary:focus-visible,
  .btn-return:focus-visible,
  .snippet-chip:focus-visible,
  .mode-btn:focus-visible,
  .btn-icon-danger:focus-visible,
  .btn-sm:focus-visible {
    outline: 2px solid var(--accent-primary, #1db954);
    outline-offset: 2px;
  }

  .code-editor:focus-visible,
  .scheme-select:focus-visible,
  .scheme-input:focus-visible,
  .form-input:focus-visible,
  .form-textarea:focus-visible,
  .token-hex-input:focus-visible,
  .accent-picker-inline input[type="color"]:focus-visible,
  .token-controls input[type="color"]:focus-visible {
    outline: 2px solid var(--accent-primary, #1db954);
    outline-offset: 1px;
    border-color: var(--accent-primary, #1db954);
  }

  /* Touch device target sizes (R-03 / antislop-human / antislop-layoutmobile) */
  @media (pointer: coarse), (max-width: 768px) {
    .header-action-btn,
    .close-btn,
    .btn-icon-danger {
      min-width: 44px;
      min-height: 44px;
    }

    .snippet-chip,
    .mode-btn,
    .tab-btn,
    .btn-sm {
      min-height: 44px;
    }
  }
</style>
