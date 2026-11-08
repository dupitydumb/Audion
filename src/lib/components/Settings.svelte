<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { _ } from "svelte-i18n";
  import Icon from "$lib/components/Icon.svelte";
  import { isLoggedIn } from "$lib/stores/sync";
  import { isMobile } from "$lib/stores/mobile";
  import "./settings/styles.css";

  // Section components
  import GeneralSection from "./settings/GeneralSection.svelte";
  import AudioSection from "./settings/AudioSection.svelte";
  import EqualizerEditor from "./settings/EqualizerEditor.svelte";
  import PlaybackSection from "./settings/PlaybackSection.svelte";
  import LyricsSection from "./settings/LyricsSection.svelte";
  import StorageSection from "./settings/StorageSection.svelte";
  import ArtistsSection from "./settings/ArtistsSection.svelte";
  import SubsonicSection from "./settings/SubsonicSection.svelte";
  import AppearanceSection from "./settings/AppearanceSection.svelte";
  import ThemeBrowserSection from "./settings/ThemeBrowserSection.svelte";
  import AccountSection from "./settings/AccountSection.svelte";
  import SyncSection from "./settings/SyncSection.svelte";
  import ScrobblingSection from "./settings/ScrobblingSection.svelte";
  import PrivacySection from "./settings/PrivacySection.svelte";
  import AboutSection from "./settings/AboutSection.svelte";

  // Navigation & state
  let activeTab = "general";
  let showEqEditor = false;
  let appearanceAdvancedOpen = false;
  let searchQuery = "";
  let activeIdx = 0;
  let searchInputEl: HTMLInputElement | null = null;
  let searchWrapperRef: HTMLDivElement | null = null;

  $: currentTabInfo = TABS.find((t) => t.id === activeTab);

  // Mobile drill-down state (null = category list, string = active category detail view)
  let mobileDetailTab: string | null = null;

  // Responsive breakpoint detection (shared 768px breakpoint)
  const DESKTOP_MEDIA_QUERY = "(min-width: 769px)";
  let isDesktopViewport = true;
  let mqlListenerCleanup: (() => void) | null = null;

  $: isDesktopView = isDesktopViewport && !$isMobile;

  // ---------------------------------------------------------------------
  // Category Definitions (User Mental Model: 8 Categories)
  // ---------------------------------------------------------------------
  const TABS = [
    {
      id: "general",
      icon: "sliders",
      label: "General",
      subtitle: "Startup, language & shortcuts",
    },
    {
      id: "sound",
      icon: "volume-2",
      label: "Sound",
      subtitle: "Audio driver, equalizer & replay gain",
    },
    {
      id: "playback",
      icon: "play",
      label: "Playback",
      subtitle: "Autoplay & lyrics settings",
    },
    {
      id: "library",
      icon: "library",
      label: "Library",
      subtitle: "Music folders, covers & Subsonic",
    },
    {
      id: "appearance",
      icon: "palette",
      label: "Appearance",
      subtitle: "Themes, accent colors & skin studio",
    },
    {
      id: "account",
      icon: "user",
      label: "Account",
      subtitle: "Cloud profile, sync & scrobbling",
    },
    {
      id: "privacy",
      icon: "shield",
      label: "Privacy & Data",
      subtitle: "Remote control & database tools",
    },
    {
      id: "about",
      icon: "info",
      label: "About",
      subtitle: "Version info, updates & support",
    },
  ];

  // ---------------------------------------------------------------------
  // Search Index Schema
  // ---------------------------------------------------------------------
  type SettingIndexItem = {
    sectionId: string;
    targetElementId?: string;
    tab: string;
    tabLabel: string;
    title: string;
    subtitle?: string;
    keywords: string[];
    isAdvanced?: boolean;
  };

  const SETTINGS_INDEX: SettingIndexItem[] = [
    // General Tab
    {
      sectionId: "startup",
      targetElementId: "setting-startup-page",
      tab: "general",
      tabLabel: "General",
      title: "Startup Page",
      subtitle: "Choose which view appears when Audion opens",
      keywords: [
        "startup",
        "launch",
        "home page",
        "default view",
        "initial page",
        "boot",
        "last visited",
      ],
    },
    {
      sectionId: "startup",
      targetElementId: "setting-autostart",
      tab: "general",
      tabLabel: "General",
      title: "Launch on Startup",
      subtitle: "Automatically start Audion when your computer boots up",
      keywords: [
        "autostart",
        "boot",
        "windows startup",
        "login",
        "launch at login",
        "background",
      ],
    },
    {
      sectionId: "language",
      targetElementId: "setting-language",
      tab: "general",
      tabLabel: "General",
      title: "Language",
      subtitle: "Switch display language (English, Spanish, French, Russian)",
      keywords: [
        "language",
        "locale",
        "translation",
        "english",
        "espanol",
        "francais",
        "russian",
        "idioma",
        "langue",
      ],
    },
    {
      sectionId: "shortcuts",
      targetElementId: "setting-shortcuts",
      tab: "general",
      tabLabel: "General",
      title: "Keyboard Shortcuts",
      subtitle: "View and customize global player hotkeys and keybindings",
      keywords: [
        "shortcuts",
        "hotkeys",
        "keyboard",
        "keybindings",
        "space",
        "play pause",
        "skip",
        "volume up",
        "volume down",
      ],
    },

    // Sound Tab
    {
      sectionId: "audio",
      targetElementId: "setting-output-driver",
      tab: "sound",
      tabLabel: "Sound",
      title: "Output Driver (Audio Backend)",
      subtitle: "Select Native, Rodio, or HTML5 playback engine",
      keywords: [
        "output driver",
        "backend",
        "driver",
        "native",
        "html5",
        "rodio",
        "engine",
        "playback driver",
        "sound engine",
      ],
    },
    {
      sectionId: "audio",
      targetElementId: "setting-output-device",
      tab: "sound",
      tabLabel: "Sound",
      title: "Output Audio Device",
      subtitle: "Choose speakers, headphones, or external sound card",
      keywords: [
        "output device",
        "speakers",
        "headphones",
        "soundcard",
        "dac",
        "audio device",
        "bluetooth",
        "airplay",
      ],
    },
    {
      sectionId: "audio",
      targetElementId: "setting-equalizer",
      tab: "sound",
      tabLabel: "Sound",
      title: "Equalizer & EQ Presets",
      subtitle:
        "Audio frequency bands, presets, customizable EQ response curve",
      keywords: [
        "equalizer",
        "eq",
        "bass",
        "treble",
        "bands",
        "preset",
        "frequency",
        "gain",
        "preamp",
        "sound profile",
      ],
    },
    {
      sectionId: "audio",
      targetElementId: "setting-replay-gain",
      tab: "sound",
      tabLabel: "Sound",
      title: "ReplayGain & Safety Limiter",
      subtitle: "Volume normalization and clipping protection across tracks",
      keywords: [
        "replaygain",
        "replay gain",
        "limiter",
        "clipping",
        "loudness",
        "normalize",
        "volume normalization",
        "safety limiter",
      ],
    },
    {
      sectionId: "audio",
      targetElementId: "setting-crossfade",
      tab: "sound",
      tabLabel: "Sound",
      title: "Crossfade",
      subtitle: "Smooth fade between consecutive tracks (0s to 12s)",
      keywords: [
        "crossfade",
        "fade",
        "transition",
        "gapless",
        "fade in",
        "fade out",
        "overlap",
      ],
    },

    // Playback Tab
    {
      sectionId: "playback",
      targetElementId: "setting-autoplay",
      tab: "playback",
      tabLabel: "Playback",
      title: "Autoplay & Queue",
      subtitle: "Keep playing similar tracks when queue finishes",
      keywords: [
        "playback",
        "autoplay",
        "queue",
        "play",
        "infinite play",
        "continuous",
        "next track",
      ],
    },
    {
      sectionId: "lyrics",
      targetElementId: "setting-lyrics-autofetch",
      tab: "playback",
      tabLabel: "Playback",
      title: "Auto-Fetch Lyrics",
      subtitle: "Automatically retrieve synced karaoke lyrics when tracks play",
      keywords: [
        "lyrics",
        "synced",
        "karaoke",
        "lrc",
        "fetch lyrics",
        "online lyrics",
        "lrclib",
        "words",
      ],
    },
    {
      sectionId: "lyrics",
      targetElementId: "setting-lyrics-alignment",
      tab: "playback",
      tabLabel: "Playback",
      title: "Dynamic Lyrics Alignment",
      subtitle: "Structure-aware line alignment based on surrounding lyrics",
      keywords: [
        "lyrics alignment",
        "dynamic alignment",
        "centered lyrics",
        "sing along",
      ],
    },
    {
      sectionId: "lyrics",
      targetElementId: "setting-lyrics-priority",
      tab: "playback",
      tabLabel: "Playback",
      title: "Lyrics Source Priority",
      subtitle:
        "Controls the search order (user, embedded, apple, lrclib, genius)",
      keywords: [
        "lyrics priority",
        "lyrics sources",
        "genius",
        "apple music",
        "lrclib",
        "musixmatch",
        "source order",
      ],
    },
    {
      sectionId: "lyrics",
      targetElementId: "setting-lyrics-delete",
      tab: "playback",
      tabLabel: "Playback",
      title: "Delete Cached Lyrics",
      subtitle:
        "Bulk remove cached lyrics files for a specific provider or all sources",
      keywords: [
        "delete lyrics",
        "clear lyrics cache",
        "remove lyrics",
        "purge lyrics",
      ],
    },

    // Library Tab
    {
      sectionId: "storage",
      targetElementId: "setting-download-location",
      tab: "library",
      tabLabel: "Library",
      title: "Download Location",
      subtitle: "Directory where downloaded tracks and files are saved",
      keywords: [
        "download location",
        "download folder",
        "downloads",
        "path",
        "save directory",
        "location",
        "folder",
      ],
    },
    {
      sectionId: "storage",
      targetElementId: "setting-music-folders",
      tab: "library",
      tabLabel: "Library",
      title: "Music Library Folders",
      subtitle: "Folders scanned for audio files, tags, and albums",
      keywords: [
        "music folder",
        "scan folder",
        "add folder",
        "directory",
        "rescan",
        "library folder",
        "storage",
        "local music",
      ],
    },
    {
      sectionId: "storage",
      targetElementId: "setting-cover-management",
      tab: "library",
      tabLabel: "Library",
      title: "Cover Management & Cache",
      subtitle: "Sync album covers or merge duplicates to free disk space",
      keywords: [
        "cover",
        "cache",
        "covers",
        "merge duplicates",
        "album art",
        "disk space",
        "artwork",
        "auto fetch",
        "online",
        "download covers",
        "fetch covers",
        "clear fetched covers",
        "remove covers",
      ],
    },
    {
      sectionId: "artists",
      targetElementId: "setting-artist-delimiters",
      tab: "library",
      tabLabel: "Library",
      title: "Artist Separation Delimiters",
      subtitle:
        "Split collaboration tracks by delimiters (feat., ft., ;, /, &)",
      keywords: [
        "artist",
        "separator",
        "featuring",
        "ft",
        "delimiters",
        "split",
        "collab",
        "multiple artists",
        "album artist mode",
      ],
    },
    {
      sectionId: "subsonic",
      targetElementId: "setting-subsonic",
      tab: "library",
      tabLabel: "Library",
      title: "Subsonic & Navidrome Server",
      subtitle:
        "Connect your personal self-hosted music server and stream your remote collection",
      keywords: [
        "subsonic",
        "navidrome",
        "server",
        "stream",
        "remote library",
        "url",
        "credentials",
        "self hosted",
        "jellyfin",
        "airsonic",
        "lms",
      ],
    },

    // Appearance Tab
    {
      sectionId: "appearance",
      targetElementId: "setting-layout-mode",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Layout Mode (Auto / Desktop / Mobile / Hybrid)",
      subtitle: "Switch between responsive desktop, mobile, or hybrid view",
      keywords: [
        "layout mode",
        "desktop layout",
        "mobile layout",
        "hybrid",
        "responsive",
        "ui mode",
        "phone layout",
      ],
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-theme-mode",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Theme Mode (Dark / Light / System)",
      subtitle: "Switch between dark, light, or auto theme mode",
      keywords: [
        "theme mode",
        "dark mode",
        "light mode",
        "system mode",
        "theme",
        "color scheme",
      ],
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-accent-color",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Accent Colors & Palette Swatches",
      subtitle: "Pick preset accents or configure custom HEX accent color",
      keywords: [
        "accent",
        "color",
        "custom colors",
        "palette",
        "green",
        "blue",
        "tokens",
        "swatch",
        "hex",
      ],
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-custom-colors",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Custom Color Tokens & Player Matching",
      subtitle:
        "Detailed colors for backgrounds, cards, sidebar, text, borders",
      keywords: [
        "tokens",
        "custom colors",
        "background color",
        "card color",
        "sidebar color",
        "match player to art",
        "palette tokens",
      ],
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-background",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Background Effects & Visualizer",
      subtitle:
        "Gradients, canvas visualizer effects, animations, image/video backgrounds",
      keywords: [
        "background",
        "gradient",
        "canvas",
        "effect",
        "overlay",
        "blur",
        "animation",
        "visualizer",
        "page transition",
        "video background",
      ],
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-skin-studio",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Skin Studio (Live Skin & CSS Editor)",
      subtitle: "Customize layouts with CSS, edit color schemes, author skins",
      keywords: [
        "skin studio",
        "skin editor",
        "css",
        "user.css",
        "custom css",
        "schemes",
        "skins",
        "spicetify",
        "author skin",
      ],
      isAdvanced: true,
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-custom-css",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Custom CSS (user.css)",
      subtitle:
        "Quick live CSS stylesheet injection to style any player element",
      keywords: [
        "css",
        "user.css",
        "custom css",
        "styling",
        "stylesheet",
        "inject css",
        "custom styles",
      ],
      isAdvanced: true,
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-custom-js",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Custom JavaScript (Scripts)",
      subtitle: "Allow custom JavaScript scripts to execute with your skins",
      keywords: [
        "custom js",
        "custom javascript",
        "scripts",
        "plugins",
        "extensions",
        "scripting",
      ],
      isAdvanced: true,
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-theme-package",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Skin Package Export & Import",
      subtitle: "Save and load .audionskin and .audiotheme files",
      keywords: [
        "audionskin",
        "audiotheme",
        "export skin",
        "import skin",
        "package",
        "share skin",
        "skins",
      ],
      isAdvanced: true,
    },
    {
      sectionId: "appearance",
      targetElementId: "setting-community-skins",
      tab: "appearance",
      tabLabel: "Appearance",
      title: "Community Skin Browser",
      subtitle:
        "Explore community skins: Nord, Catppuccin, Gruvbox, Liquid Glass, etc.",
      keywords: [
        "skin browser",
        "theme browser",
        "community skins",
        "community themes",
        "nord",
        "catppuccin",
        "mocha",
        "gruvbox",
        "matrix",
        "frost",
        "install skin",
      ],
      isAdvanced: true,
    },

    // Account Tab
    {
      sectionId: "account",
      targetElementId: "setting-account-profile",
      tab: "account",
      tabLabel: "Account",
      title: "Account Profile & Supporter Status",
      subtitle: "Cloud sign-in, avatar, and supporter status",
      keywords: [
        "account",
        "login",
        "logout",
        "user",
        "profile",
        "supporter",
        "subscription",
        "avatar",
        "trial",
      ],
    },
    {
      sectionId: "account",
      targetElementId: "setting-custom-server",
      tab: "account",
      tabLabel: "Account",
      title: "Custom Server (Supporter Cloud)",
      subtitle: "Connect to a custom server with URL, username, and password",
      keywords: [
        "custom server",
        "server url",
        "supporter",
        "cloud",
        "music locker",
        "username",
        "password",
        "self-hosted",
        "remote library",
      ],
    },
    {
      sectionId: "sync",
      targetElementId: "setting-sync",
      tab: "account",
      tabLabel: "Account",
      title: "Cloud & Database Sync",
      subtitle: "Real-time synchronization across devices and cloud backup",
      keywords: [
        "sync",
        "cloud sync",
        "backup",
        "devices",
        "pending changes",
        "library status",
        "database sync",
      ],
    },
    {
      sectionId: "scrobbling",
      targetElementId: "setting-listenbrainz",
      tab: "account",
      tabLabel: "Account",
      title: "ListenBrainz & Scrobbling",
      subtitle: "Submit listening history to ListenBrainz and track your stats",
      keywords: [
        "listenbrainz",
        "scrobble",
        "token",
        "tracking",
        "history",
        "stats",
        "lastfm",
        "scrobbling",
      ],
    },

    // Privacy & Data Tab
    {
      sectionId: "privacy",
      targetElementId: "setting-remote-control",
      tab: "privacy",
      tabLabel: "Privacy & Data",
      title: "Remote Control API",
      subtitle:
        "Allow external devices on your local network to discover and control Audion",
      keywords: [
        "privacy",
        "remote control",
        "local api",
        "connect device",
        "remote playback",
        "network",
      ],
    },
    {
      sectionId: "privacy",
      targetElementId: "setting-developer-mode",
      tab: "privacy",
      tabLabel: "Privacy & Data",
      title: "Developer Mode & Diagnostics",
      subtitle:
        "Enable inspection tools, developer console logs, and debug menus",
      keywords: [
        "developer mode",
        "debug",
        "devtools",
        "developer tools",
        "logs",
        "inspection",
      ],
    },
    {
      sectionId: "privacy",
      targetElementId: "setting-export-logs",
      tab: "privacy",
      tabLabel: "Privacy & Data",
      title: "Export Diagnostic Logs",
      subtitle:
        "Export application logs to a file for bug troubleshooting and support",
      keywords: [
        "export logs",
        "diagnostic logs",
        "log file",
        "troubleshooting",
        "error log",
        "report bug",
      ],
    },
    {
      sectionId: "privacy",
      targetElementId: "setting-danger-zone",
      tab: "privacy",
      tabLabel: "Privacy & Data",
      title: "Danger Zone & Reset Database",
      subtitle:
        "Wipe database metadata, clear track index, or delete cloud account",
      keywords: [
        "danger zone",
        "reset database",
        "clear cache",
        "database",
        "wipe",
        "delete account",
        "clear data",
        "reset",
      ],
    },

    // About Tab
    {
      sectionId: "about",
      targetElementId: "setting-about-app",
      tab: "about",
      tabLabel: "About",
      title: "About Audion & Updates",
      subtitle: "Version info, credits, release notes, and OTA update checks",
      keywords: [
        "about",
        "version",
        "update",
        "changelog",
        "release",
        "credits",
        "license",
        "github",
        "ota update",
      ],
    },
    {
      sectionId: "about",
      targetElementId: "setting-support-audion",
      tab: "about",
      tabLabel: "About",
      title: "Support Audion & Community Links",
      subtitle:
        "Ko-fi, Patreon, Discord server, Resonate playlists, and GitHub",
      keywords: [
        "support",
        "donate",
        "patreon",
        "pro",
        "kofi",
        "ko-fi",
        "discord",
        "resonate",
        "community",
        "github",
        "issues",
      ],
    },
  ];

  // ---------------------------------------------------------------------
  // Filter index by actual visibility
  // ---------------------------------------------------------------------
  $: visibleIndex = SETTINGS_INDEX.filter(
    (i) =>
      !(i.sectionId === "sync" && !$isLoggedIn) &&
      !(i.sectionId === "shortcuts" && $isMobile),
  );

  // ---------------------------------------------------------------------
  // Search Scoring & Tokenized Ranking
  // ---------------------------------------------------------------------
  function score(item: SettingIndexItem, tokens: string[]): number {
    const title = item.title.toLowerCase();
    let total = 0;
    for (const t of tokens) {
      if (title.startsWith(t)) total += 100;
      else if (title.includes(t)) total += 60;
      else if (item.keywords.some((k) => k.toLowerCase().startsWith(t)))
        total += 40;
      else if (item.keywords.some((k) => k.toLowerCase().includes(t)))
        total += 25;
      else if (item.subtitle?.toLowerCase().includes(t)) total += 10;
      else return 0; // all tokens must match somewhere
    }
    return total;
  }

  $: searchResults = (() => {
    const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return visibleIndex
      .map((item) => ({ item, s: score(item, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item);
  })();

  $: if (searchResults) activeIdx = 0;

  // ---------------------------------------------------------------------
  // Keyboard Navigation in Search
  // ---------------------------------------------------------------------
  function onSearchKey(e: KeyboardEvent) {
    if (!searchResults.length) return;
    if (e.key === "ArrowDown") {
      activeIdx = Math.min(activeIdx + 1, searchResults.length - 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      activeIdx = Math.max(activeIdx - 1, 0);
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (searchResults[activeIdx]) {
        e.preventDefault();
        navigateToSetting(searchResults[activeIdx]);
      }
    } else if (e.key === "Escape") {
      searchQuery = "";
      searchInputEl?.blur();
    }
  }

  function handleSearchOutside(e: MouseEvent) {
    if (searchWrapperRef && !searchWrapperRef.contains(e.target as Node)) {
      searchQuery = "";
    }
  }

  // ---------------------------------------------------------------------
  // Navigation to Setting (Instant scroll + glow flash)
  // ---------------------------------------------------------------------
  async function navigateToSetting(item: SettingIndexItem) {
    activeTab = item.tab;
    mobileDetailTab = item.tab;
    showEqEditor = false;

    if (item.isAdvanced) {
      appearanceAdvancedOpen = true;
    }

    searchQuery = "";

    try {
      localStorage.setItem("audion_settings_tab", item.tab);
    } catch {}

    await tick();
    requestAnimationFrame(() => {
      let targetEl: HTMLElement | null = null;
      if (item.targetElementId) {
        targetEl = document.getElementById(item.targetElementId);
      }
      if (!targetEl) {
        targetEl = document.querySelector(
          `[aria-labelledby="${item.sectionId}-heading"]`,
        );
      }
      if (targetEl) {
        const pane = targetEl.closest(".settings-pane") as HTMLElement | null;
        if (pane) {
          const paneRect = pane.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const targetTopRelativeToPane =
            targetRect.top - paneRect.top + pane.scrollTop;
          const centeredScrollTop =
            targetTopRelativeToPane -
            pane.clientHeight / 2 +
            targetRect.height / 2;
          pane.scrollTo({
            top: Math.max(0, centeredScrollTop),
            behavior: "smooth",
          });
        } else {
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        targetEl.classList.remove("setting-highlight-flash");
        void targetEl.offsetWidth; // Force reflow
        targetEl.classList.add("setting-highlight-flash");
        setTimeout(() => {
          targetEl?.classList.remove("setting-highlight-flash");
        }, 2200);
      }
    });
  }

  function switchTab(id: string) {
    activeTab = id;
    mobileDetailTab = id;
    showEqEditor = false;
    try {
      localStorage.setItem("audion_settings_tab", id);
    } catch {}
  }

  function onTabKeydown(e: KeyboardEvent, index: number) {
    let nextIndex = index;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (index + 1) % TABS.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = TABS.length - 1;
    }
    if (nextIndex !== index) {
      switchTab(TABS[nextIndex].id);
      const btn = document.getElementById(`tab-${TABS[nextIndex].id}`);
      btn?.focus();
    }
  }

  // ---------------------------------------------------------------------
  // Lifecycle & Persistence
  // ---------------------------------------------------------------------
  onMount(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-settings-open", "true");
    }

    // Restore last visited tab from localStorage
    try {
      const savedTab = localStorage.getItem("audion_settings_tab");
      if (savedTab && TABS.some((t) => t.id === savedTab)) {
        activeTab = savedTab;
      }
    } catch {}

    // Clean matchMedia setup
    if (typeof window !== "undefined") {
      const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
      isDesktopViewport = mql.matches;
      const onChange = (e: MediaQueryListEvent) => {
        isDesktopViewport = e.matches;
      };
      mql.addEventListener("change", onChange);
      mqlListenerCleanup = () => mql.removeEventListener("change", onChange);
    }
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      document.documentElement.removeAttribute("data-settings-open");
    }
    if (mqlListenerCleanup) mqlListenerCleanup();
  });
</script>

<svelte:window on:mousedown={handleSearchOutside} />

<div
  class="settings-view"
  class:is-desktop={isDesktopView}
  class:is-mobile={!isDesktopView}
>
  <!-- ================================================================= -->
  <!-- DESKTOP LAYOUT (Sidebar + Content Pane)                           -->
  <!-- ================================================================= -->
  {#if isDesktopView}
    <div class="settings-desktop-layout">
      <!-- Left Sidebar -->
      <aside class="settings-sidebar">
        <!-- Search Toolbar in Sidebar -->
        <div class="settings-search-wrapper" bind:this={searchWrapperRef}>
          <Icon name="search" size={15} className="search-icon" />
          <input
            type="search"
            class="settings-search-input"
            placeholder={$_("settings.searchSettings", {
              default: "Search settings",
            })}
            bind:value={searchQuery}
            bind:this={searchInputEl}
            on:keydown={onSearchKey}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchResults.length > 0}
            aria-controls="desktop-search-results"
          />
          {#if searchQuery}
            <button
              class="search-clear-btn"
              on:click={() => (searchQuery = "")}
              aria-label={$_("search.searchHistoryClear", {
                default: "Clear search",
              })}
            >
              <Icon name="x" size={13} />
            </button>
          {/if}

          <!-- Search Dropdown Results -->
          {#if searchQuery.trim()}
            <div
              class="settings-search-results"
              id="desktop-search-results"
              role="listbox"
            >
              {#if searchResults.length === 0}
                <div class="search-no-results">
                  {$_("settings.noSettingsFound", {
                    values: { query: searchQuery },
                    default: `No settings found matching "${searchQuery}"`,
                  })}
                </div>
              {:else}
                {#each searchResults as res, i}
                  <button
                    class="search-result-item"
                    class:active={i === activeIdx}
                    role="option"
                    aria-selected={i === activeIdx}
                    id={"search-opt-" + i}
                    on:click={() => navigateToSetting(res)}
                  >
                    <div class="search-res-text">
                      <span class="search-res-title">{res.title}</span>
                      {#if res.subtitle}
                        <span class="search-res-subtitle">{res.subtitle}</span>
                      {/if}
                    </div>
                    <span class="search-res-tab">{res.tabLabel}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Vertical Category Tabs -->
        <div
          class="sidebar-category-list"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings categories"
        >
          {#each TABS as tab, idx}
            {@const isActive = activeTab === tab.id}
            <button
              id={`tab-${tab.id}`}
              class="sidebar-tab-btn"
              class:active={isActive}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabindex={isActive ? 0 : -1}
              on:click={() => switchTab(tab.id)}
              on:keydown={(e) => onTabKeydown(e, idx)}
            >
              <span class="tab-icon-wrap" class:active={isActive}>
                <Icon name={tab.icon} size={16} />
              </span>
              <div class="tab-label-group">
                <span class="tab-title">{tab.label}</span>
              </div>
            </button>
          {/each}
        </div>
      </aside>

      <!-- Right Main Content Pane -->
      <main class="settings-main-pane">
        {#if showEqEditor}
          <div class="settings-pane content-column">
            <EqualizerEditor on:back={() => (showEqEditor = false)} />
          </div>
        {:else}
          <div
            class="settings-pane content-column"
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
          >
            <!-- Category Header -->
            {#if currentTabInfo}
              <header class="category-header">
                <div class="category-header-text">
                  <h1 class="category-title">{currentTabInfo.label}</h1>
                  <p class="category-subtitle">{currentTabInfo.subtitle}</p>
                </div>
              </header>
            {/if}

            <!-- Category Body Content -->
            <div class="category-sections">
              {#if activeTab === "general"}
                <GeneralSection open={true} />
              {:else if activeTab === "sound"}
                <AudioSection
                  open={true}
                  on:openEqEditor={() => (showEqEditor = true)}
                />
              {:else if activeTab === "playback"}
                <PlaybackSection open={true} />
                <div style="margin-top: var(--spacing-lg);">
                  <LyricsSection open={true} />
                </div>
              {:else if activeTab === "library"}
                <StorageSection open={true} />
                <div style="margin-top: var(--spacing-lg);">
                  <ArtistsSection open={true} />
                </div>
                <div style="margin-top: var(--spacing-lg);">
                  <SubsonicSection open={true} />
                </div>
              {:else if activeTab === "appearance"}
                <AppearanceSection
                  open={true}
                  bind:advancedOpen={appearanceAdvancedOpen}
                />
                <div style="margin-top: var(--spacing-lg);">
                  <ThemeBrowserSection open={true} />
                </div>
              {:else if activeTab === "account"}
                <AccountSection open={true} />
                {#if $isLoggedIn}
                  <div style="margin-top: var(--spacing-lg);">
                    <SyncSection open={true} />
                  </div>
                {/if}
                <div style="margin-top: var(--spacing-lg);">
                  <ScrobblingSection open={true} />
                </div>
              {:else if activeTab === "privacy"}
                <PrivacySection open={true} />
              {:else if activeTab === "about"}
                <AboutSection open={true} />
              {/if}
            </div>
          </div>
        {/if}
      </main>
    </div>

    <!-- ================================================================= -->
    <!-- MOBILE LAYOUT (Drill-Down List Pattern)                           -->
    <!-- ================================================================= -->
  {:else}
    <div class="settings-mobile-layout">
      <!-- Mobile Top Navigation Header -->
      <header class="mobile-nav-header">
        {#if mobileDetailTab !== null || showEqEditor}
          <button
            class="mobile-back-btn"
            on:click={() => {
              if (showEqEditor) {
                showEqEditor = false;
              } else {
                mobileDetailTab = null;
              }
            }}
            aria-label={$_("common.back", { default: "Back" })}
          >
            <Icon name="arrow-left" size={18} />
            <span>{$_("settings.title", { default: "Settings" })}</span>
          </button>
          <span class="mobile-header-title">
            {showEqEditor
              ? $_("settings.equalizer", { default: "Equalizer" })
              : (TABS.find((t) => t.id === mobileDetailTab)?.label ?? "")}
          </span>
        {:else}
          <div class="mobile-main-title">
            <h1>{$_("settings.title", { default: "Settings" })}</h1>
          </div>
        {/if}
      </header>

      <!-- Mobile Search Bar -->
      <div class="mobile-search-bar" bind:this={searchWrapperRef}>
        <div class="settings-search-wrapper">
          <Icon name="search" size={15} className="search-icon" />
          <input
            type="search"
            class="settings-search-input"
            placeholder={$_("settings.searchSettings", {
              default: "Search settings",
            })}
            bind:value={searchQuery}
            bind:this={searchInputEl}
            on:keydown={onSearchKey}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchResults.length > 0}
            aria-controls="mobile-search-results"
          />
          {#if searchQuery}
            <button
              class="search-clear-btn"
              on:click={() => (searchQuery = "")}
              aria-label={$_("search.searchHistoryClear", {
                default: "Clear search",
              })}
            >
              <Icon name="x" size={13} />
            </button>
          {/if}

          <!-- Search Dropdown -->
          {#if searchQuery.trim()}
            <div
              class="settings-search-results mobile-search-dropdown"
              id="mobile-search-results"
              role="listbox"
            >
              {#if searchResults.length === 0}
                <div class="search-no-results">
                  {$_("settings.noSettingsFound", {
                    values: { query: searchQuery },
                    default: `No settings found matching "${searchQuery}"`,
                  })}
                </div>
              {:else}
                {#each searchResults as res, i}
                  <button
                    class="search-result-item"
                    class:active={i === activeIdx}
                    role="option"
                    aria-selected={i === activeIdx}
                    id={"mobile-opt-" + i}
                    on:click={() => navigateToSetting(res)}
                  >
                    <div class="search-res-text">
                      <span class="search-res-title">{res.title}</span>
                      {#if res.subtitle}
                        <span class="search-res-subtitle">{res.subtitle}</span>
                      {/if}
                    </div>
                    <span class="search-res-tab">{res.tabLabel}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Mobile View Body: Drill-Down List vs Detail View -->
      <div class="mobile-body-container">
        {#if showEqEditor}
          <div class="settings-pane mobile-detail-pane">
            <EqualizerEditor on:back={() => (showEqEditor = false)} />
          </div>
        {:else if mobileDetailTab === null}
          <!-- Drill-down Category List (Instagram / iOS Settings style) -->
          <div class="mobile-categories-list" role="list">
            {#each TABS as tab}
              <button
                class="mobile-category-row"
                on:click={() => {
                  mobileDetailTab = tab.id;
                  activeTab = tab.id;
                }}
                role="listitem"
              >
                <div class="mobile-category-icon-badge">
                  <Icon name={tab.icon} size={18} />
                </div>
                <div class="mobile-category-info">
                  <span class="mobile-category-name">{tab.label}</span>
                  <span class="mobile-category-sub">{tab.subtitle}</span>
                </div>
                <div class="mobile-category-chevron">
                  <Icon name="chevron-right" size={18} />
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <!-- Category Detail View -->
          <div
            class="settings-pane mobile-detail-pane"
            id={`panel-${mobileDetailTab}`}
            role="tabpanel"
          >
            <div class="category-sections">
              {#if mobileDetailTab === "general"}
                <GeneralSection open={true} />
              {:else if mobileDetailTab === "sound"}
                <AudioSection
                  open={true}
                  on:openEqEditor={() => (showEqEditor = true)}
                />
              {:else if mobileDetailTab === "playback"}
                <PlaybackSection open={true} />
                <div style="margin-top: var(--spacing-md);">
                  <LyricsSection open={true} />
                </div>
              {:else if mobileDetailTab === "library"}
                <StorageSection open={true} />
                <div style="margin-top: var(--spacing-md);">
                  <ArtistsSection open={true} />
                </div>
                <div style="margin-top: var(--spacing-md);">
                  <SubsonicSection open={true} />
                </div>
              {:else if mobileDetailTab === "appearance"}
                <AppearanceSection
                  open={true}
                  bind:advancedOpen={appearanceAdvancedOpen}
                />
                <div style="margin-top: var(--spacing-md);">
                  <ThemeBrowserSection open={true} />
                </div>
              {:else if mobileDetailTab === "account"}
                <AccountSection open={true} />
                {#if $isLoggedIn}
                  <div style="margin-top: var(--spacing-md);">
                    <SyncSection open={true} />
                  </div>
                {/if}
                <div style="margin-top: var(--spacing-md);">
                  <ScrobblingSection open={true} />
                </div>
              {:else if mobileDetailTab === "privacy"}
                <PrivacySection open={true} />
              {:else if mobileDetailTab === "about"}
                <AboutSection open={true} />
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Root View ── */
  .settings-view {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-base);
    position: relative;
    z-index: 10;
    isolation: isolate;
  }

  :global(html[data-settings-open="true"] #audion-effect-layer) {
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* ═════════════════════════════════════════════════════════════════ */
  /* DESKTOP LAYOUT STYLES (Sidebar + Content Column)                  */
  /* ═════════════════════════════════════════════════════════════════ */
  .settings-desktop-layout {
    display: flex;
    height: 100%;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }

  /* Left Sidebar */
  .settings-sidebar {
    width: 250px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-color);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 12px;
    overflow-y: auto;
  }

  /* Search Toolbar inside Sidebar */
  .settings-search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .settings-search-wrapper :global(.search-icon) {
    position: absolute;
    left: 10px;
    color: var(--text-subdued);
    pointer-events: none;
  }

  .settings-search-input {
    width: 100%;
    height: 36px;
    padding: 0 32px 0 32px;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    color: var(--text-primary);
    font-size: 0.8125rem;
    outline: none;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast);
  }

  .settings-search-input:focus {
    border-color: var(--accent-primary);
    background: var(--bg-elevated);
  }

  .settings-search-input::placeholder {
    color: var(--text-subdued);
  }

  .search-clear-btn {
    position: absolute;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .search-clear-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.2);
  }

  /* Search Results Dropdown */
  .settings-search-results {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
    max-height: 340px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    z-index: 200;
  }

  .search-no-results {
    padding: 16px;
    font-size: 0.8125rem;
    color: var(--text-subdued);
    text-align: center;
  }

  .search-result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border: none;
    background: transparent;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);
  }

  .search-result-item:last-child {
    border-bottom: none;
  }

  .search-result-item:hover,
  .search-result-item.active {
    background: var(--bg-highlight);
  }

  .search-res-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .search-res-title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .search-res-subtitle {
    font-size: 0.71875rem;
    color: var(--text-subdued);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-res-tab {
    font-size: 0.6875rem;
    color: var(--text-subdued);
    background: var(--bg-surface);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  /* Sidebar Category Navigation */
  .sidebar-category-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 4px;
  }

  .sidebar-tab-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: none;
    border: none;
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
    outline: none;
    user-select: none;
  }

  .sidebar-tab-btn:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  .sidebar-tab-btn.active {
    background: var(--bg-highlight);
    color: var(--text-primary);
    font-weight: 600;
  }

  .tab-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
    transition: color var(--transition-fast);
  }

  .sidebar-tab-btn:hover .tab-icon-wrap,
  .sidebar-tab-btn.active .tab-icon-wrap {
    color: var(--accent-primary);
  }

  .tab-label-group {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .tab-title {
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Right Main Content Column */
  .settings-main-pane {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow-y: auto;
    position: relative;
  }

  .content-column {
    margin: 0;
    padding: 28px 32px calc(var(--player-height, 80px) + 50px);
  }

  .category-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .category-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.02em;
    margin: 0 0 4px 0;
  }

  .category-subtitle {
    font-size: 0.875rem;
    color: var(--text-subdued);
    margin: 0;
  }

  .category-sections {
    display: flex;
    flex-direction: column;
  }

  /* ═════════════════════════════════════════════════════════════════ */
  /* MOBILE LAYOUT STYLES (Drill-Down List Pattern)                    */
  /* ═════════════════════════════════════════════════════════════════ */
  .settings-mobile-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }

  .mobile-nav-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-surface);
    flex-shrink: 0;
    min-height: 52px;
  }

  .mobile-main-title h1 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .mobile-back-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--accent-primary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    padding: 4px 0;
  }

  .mobile-header-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-left: auto;
  }

  .mobile-search-bar {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-base);
    flex-shrink: 0;
  }

  .mobile-search-dropdown {
    left: 10px;
    right: 10px;
    max-height: 280px;
  }

  .mobile-body-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* Drill-Down Categories List */
  .mobile-categories-list {
    display: flex;
    flex-direction: column;
    padding: 8px 12px calc(var(--mobile-bottom-inset, 130px) + 30px);
    gap: 6px;
  }

  .mobile-category-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);
  }

  .mobile-category-row:active {
    background: var(--bg-highlight);
  }

  .mobile-category-icon-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--bg-highlight);
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .mobile-category-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .mobile-category-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .mobile-category-sub {
    font-size: 0.75rem;
    color: var(--text-subdued);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-category-chevron {
    color: var(--text-subdued);
    display: flex;
    align-items: center;
  }

  .mobile-detail-pane {
    padding: 16px 14px calc(var(--mobile-bottom-inset, 130px) + 30px);
  }

  /* Glow highlight animation when navigating directly to setting item */
  :global(.setting-highlight-flash) {
    animation: setting-flash 2.2s ease-out forwards;
    border-radius: var(--radius-md, 8px);
  }

  @keyframes setting-flash {
    0% {
      outline: 2px solid var(--accent-primary);
      box-shadow: 0 0 16px var(--accent-primary);
      background-color: var(--bg-highlight);
    }
    50% {
      outline: 2px solid var(--accent-primary);
      box-shadow: 0 0 12px var(--accent-primary);
      background-color: var(--bg-highlight);
    }
    100% {
      outline: 2px solid transparent;
      box-shadow: none;
      background-color: transparent;
    }
  }

  /* Desktop section style override */
  :global(.is-desktop .settings-section) {
    border-bottom: none;
  }

  :global(.is-desktop .accordion-trigger) {
    cursor: default;
    pointer-events: none;
    padding: var(--spacing-xs) 0;
    background: none !important;
    border-bottom: 1px solid var(--border-color);
    margin-bottom: var(--spacing-sm);
  }

  :global(.is-desktop .accordion-chevron) {
    display: none;
  }

  :global(.is-desktop .accordion-title) {
    font-size: 1.05rem;
    font-weight: 600;
  }
</style>
