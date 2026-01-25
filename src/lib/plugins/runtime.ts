// Plugin loader for JS and WASM plugins
import type { AudionPluginManifest } from './schema';
import { PLUGIN_PERMISSIONS } from './schema';
import { get } from 'svelte/store';
import {
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  queue,
  togglePlay,
  nextTrack,
  previousTrack,
  seek,
  pluginEvents,
  addToQueue,
  removeFromQueue,
  reorderQueue,
  clearUpcoming
} from '$lib/stores/player';
import { tracks, playlists, loadLibrary, refreshAll } from '$lib/stores/library';
import { PluginStorage } from './plugin-storage';
import { RateLimiter, RATE_LIMITS } from './rate-limiter';
import type { EventListener } from './event-emitter';
import { uiSlotManager, type UISlotName } from './ui-slots';
import { appSettings } from '$lib/stores/settings';
import { theme } from '$lib/stores/theme';
import { invoke } from '@tauri-apps/api/core';

export interface WasmPluginExports {
  init?: () => void;
  start?: () => void;
  stop?: () => void;
  destroy?: () => void;
  memory?: WebAssembly.Memory;
}

export interface LoadedPlugin {
  manifest: AudionPluginManifest;
  instance: WasmPluginExports | any;
  enabled: boolean;
  grantedPermissions: string[];
  loadedAt: number;
  storage: PluginStorage;
  rateLimiters: {
    api: RateLimiter;
    storage: RateLimiter;
  };
  eventListeners: Map<string, EventListener[]>;
}

export interface PluginRuntimeConfig {
  pluginDir: string;
  onError?: (pluginName: string, error: Error) => void;
  onLoad?: (plugin: LoadedPlugin) => void;
}

export class PluginRuntime {
  plugins: Map<string, LoadedPlugin> = new Map();
  private grantedPermissions: Map<string, string[]> = new Map();
  private config: PluginRuntimeConfig;

  // Stream resolvers: map of source_type -> resolver function
  // Resolver takes (external_id, options?) and returns Promise<string | null> (stream URL)
  streamResolvers: Map<string, (externalId: string, options?: any) => Promise<string | null>> = new Map();

  constructor(config: PluginRuntimeConfig) {
    this.config = config;
  }

  // Create rate limiters for a plugin
  private createRateLimiters() {
    return {
      api: new RateLimiter(RATE_LIMITS.API_CALLS),
      storage: new RateLimiter(RATE_LIMITS.STORAGE_WRITES)
    };
  }

  // Grant permissions for a plugin
  grantPermissions(pluginName: string, permissions: string[]): void {
    const current = this.grantedPermissions.get(pluginName) || [];
    const combined = [...new Set([...current, ...permissions])];
    this.grantedPermissions.set(pluginName, combined);
  }

  // Revoke all permissions for a plugin
  revokePermissions(pluginName: string): void {
    this.grantedPermissions.delete(pluginName);
  }

  // Check if plugin has a specific permission granted
  hasPermission(pluginName: string, permission: string): boolean {
    const granted = this.grantedPermissions.get(pluginName) || [];
    return granted.includes(permission);
  }

  // Load a JS plugin via script tag
  private async loadJsPlugin(manifest: AudionPluginManifest): Promise<LoadedPlugin> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      // Use safe folder name (lowercase with dashes, matching Rust backend)
      const safeName = manifest.name.replace(/\s+/g, '-').toLowerCase();
      script.src = `${this.config.pluginDir}/${safeName}/${manifest.entry}`;
      script.async = true;
      script.id = `plugin-${manifest.name}`;

      script.onload = () => {
        // Try various global names the plugin might register under
        const instance = (window as any)[manifest.name.replace(/\s+/g, '')] ||
          (window as any)[manifest.name] ||
          (window as any).AudionPlugin;
        const plugin: LoadedPlugin = {
          manifest,
          instance,
          enabled: true,
          grantedPermissions: this.grantedPermissions.get(manifest.name) || [],
          loadedAt: Date.now(),
          storage: new PluginStorage(manifest.name),
          rateLimiters: this.createRateLimiters(),
          eventListeners: new Map()
        };

        // Register plugin BEFORE calling init() so storage APIs work during initialization
        this.plugins.set(manifest.name, plugin);

        // Call init if available
        if (instance?.init) {
          try {
            instance.init(this.getPluginApi(manifest.name));
          } catch (err) {
            this.config.onError?.(manifest.name, err as Error);
          }
        }

        resolve(plugin);
      };

      script.onerror = () => reject(new Error(`Failed to load JS plugin: ${manifest.name}`));
      document.body.appendChild(script);
    });
  }

  // Load a WASM plugin
  private async loadWasmPlugin(manifest: AudionPluginManifest): Promise<LoadedPlugin> {
    // Use safe folder name (lowercase with dashes, matching Rust backend)
    const safeName = manifest.name.replace(/\s+/g, '-').toLowerCase();
    const wasmUrl = `${this.config.pluginDir}/${safeName}/${manifest.entry}`;

    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.statusText}`);
      }

      const wasmBuffer = await response.arrayBuffer();
      const imports = {
        audion: this.getWasmImports(manifest.name),
        env: this.getWasmEnv()
      };

      const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
      const exports = instance.exports as WasmPluginExports;

      const plugin: LoadedPlugin = {
        manifest,
        instance: exports,
        enabled: true,
        grantedPermissions: this.grantedPermissions.get(manifest.name) || [],
        loadedAt: Date.now(),
        storage: new PluginStorage(manifest.name),
        rateLimiters: this.createRateLimiters(),
        eventListeners: new Map()
      };

      // Call lifecycle hooks
      if (exports.init) {
        exports.init();
      }

      return plugin;
    } catch (err) {
      this.config.onError?.(manifest.name, err as Error);
      throw err;
    }
  }

  // Get WASM imports based on granted permissions
  private getWasmImports(pluginName: string): Record<string, Function> {
    const api: Record<string, Function> = {};

    if (this.hasPermission(pluginName, 'player:control')) {
      api.play = () => this.callHost(pluginName, 'player.play');
      api.pause = () => this.callHost(pluginName, 'player.pause');
      api.seek = (time: number) => this.callHost(pluginName, 'player.seek', time);
      api.next = () => this.callHost(pluginName, 'player.next');
      api.prev = () => this.callHost(pluginName, 'player.prev');
    }

    if (this.hasPermission(pluginName, 'player:read')) {
      api.getCurrentTime = () => this.callHost(pluginName, 'player.getCurrentTime');
      api.getDuration = () => this.callHost(pluginName, 'player.getDuration');
      api.isPlaying = () => this.callHost(pluginName, 'player.isPlaying');
    }

    if (this.hasPermission(pluginName, 'library:read')) {
      api.getTracks = () => this.callHost(pluginName, 'library.getTracks');
      api.getPlaylists = () => this.callHost(pluginName, 'library.getPlaylists');
    }

    if (this.hasPermission(pluginName, 'library:write')) {
      api.refreshLibrary = () => this.callHost(pluginName, 'library.refresh');
    }

    if (this.hasPermission(pluginName, 'ui:inject')) {
      // For WASM, we pass the raw HTML string
      api.injectUI = (slot: string, html: string, priority: number) =>
        this.callHost(pluginName, 'ui.inject', slot, html, priority);
    }

    if (this.hasPermission(pluginName, 'storage:local')) {
      api.storageGet = (key: string) => this.callHost(pluginName, 'storage.get', key);
      api.storageSet = (key: string, value: string) => this.callHost(pluginName, 'storage.set', key, value);
    }

    // Log for ungated functions
    api.log = (_ptr: number, _len: number) => {
      // WASM string logging - would need memory access for full implementation
    };

    return api;
  }

  // Minimal WASM env imports
  private getWasmEnv(): Record<string, Function> {
    return {
      abort: () => { throw new Error('WASM aborted'); }
    };
  }

  // Host function call dispatcher - connects plugins to Audion APIs
  private callHost(pluginName: string, method: string, ...args: any[]): any {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      console.error(`[PluginRuntime] Plugin not found: ${pluginName}`);
      return null;
    }

    // Rate limit API calls
    if (!plugin.rateLimiters.api.tryConsume()) {
      console.warn(`[PluginRuntime:${pluginName}] Rate limited`);
      return null;
    }

    switch (method) {
      // Player read APIs
      case 'player.getCurrentTrack':
        return get(currentTrack);

      case 'player.isPlaying':
        return get(isPlaying);

      case 'player.getCurrentTime':
        return get(currentTime);

      case 'player.getDuration':
        return get(duration);

      case 'player.getQueue':
        return get(queue);

      // Player control APIs
      case 'player.play':
        if (!get(isPlaying)) togglePlay();
        return true;

      case 'player.pause':
        if (get(isPlaying)) togglePlay();
        return true;

      case 'player.togglePlay':
        togglePlay();
        return true;

      case 'player.next':
        nextTrack();
        return true;

      case 'player.prev':
        previousTrack();
        return true;

      case 'player.seek':
        if (typeof args[0] === 'number') {
          seek(args[0]);
          return true;
        }
        return false;

      // Queue manipulation APIs
      case 'player.addToQueue':
        if (Array.isArray(args[0])) {
          addToQueue(args[0]);
          return true;
        }
        return false;

      case 'player.removeFromQueue':
        if (typeof args[0] === 'number') {
          removeFromQueue(args[0]);
          return true;
        }
        return false;

      case 'player.reorderQueue':
        if (typeof args[0] === 'number' && typeof args[1] === 'number') {
          reorderQueue(args[0], args[1]);
          return true;
        }
        return false;

      case 'player.clearUpcoming':
        clearUpcoming();
        return true;

      // Set current track (for streaming plugins like Tidal)
      case 'player.setTrack':
        if (args[0]) {
          const track = args[0];
          const previousTrack = get(currentTrack);
          currentTrack.set(track);
          // Set duration if provided
          if (track.duration) {
            duration.set(track.duration);
          }
          // Emit trackChange event for lyrics and other plugins
          pluginEvents.emit('trackChange', { track, previousTrack });
          return true;
        }
        return false;

      // UI Injection APIs
      case 'ui.inject':
        // args: [slotName, html, priority]
        if (typeof args[0] === 'string' && typeof args[1] === 'string') {
          const slotName = args[0] as UISlotName;
          const html = args[1];
          const priority = typeof args[2] === 'number' ? args[2] : 50;

          // Create a container element for the HTML
          const element = document.createElement('div');
          element.innerHTML = html;

          uiSlotManager.addContent(slotName, {
            pluginName,
            element,
            priority
          });
          return true;
        }
        return false;

      // Storage APIs (using PluginStorage)
      case 'storage.get':
        return plugin.storage.get(args[0]);

      case 'storage.set':
        // Rate limit storage writes
        if (!plugin.rateLimiters.storage.tryConsume()) {
          console.warn(`[PluginRuntime:${pluginName}] Storage write rate limited`);
          return false;
        }
        return plugin.storage.set(args[0], args[1]);

      // Library Write APIs
      case 'library.downloadTrack':
        // args: [options: { url, filename, metadata, downloadPath? }]
        const options = args[0];
        if (!options || !options.url || !options.filename) {
          console.warn(`[PluginRuntime] Invalid download options`);
          return null;
        }

        // Determine target directory: prefer plugin-provided path, fallback to global app setting
        const globalDownloadLocation = get(appSettings).downloadLocation;
        // Accept both 'path' and 'downloadPath' properties from plugins
        const requestedPath = (options.path && typeof options.path === 'string' && options.path.trim() !== '')
          ? options.path
          : (options.downloadPath && typeof options.downloadPath === 'string' && options.downloadPath.trim() !== '')
            ? options.downloadPath
            : null;
        const targetDir = requestedPath || globalDownloadLocation;

        if (!targetDir) {
          console.warn(`[PluginRuntime] No download location set (neither plugin nor app settings)`);
          throw new Error('No download location configured in settings');
        }

        const fullPath = `${targetDir}/${options.filename}`;

        // Call Rust command
        return invoke('download_and_save_audio', {
          input: {
            url: options.url,
            path: fullPath,
            title: options.metadata?.title || null,
            artist: options.metadata?.artist || null,
            album: options.metadata?.album || null,
            track_number: options.metadata?.trackNumber || null,
            cover_url: options.metadata?.coverUrl || null
          }
        }).then(async (savedPath) => {
          // Auto-rescan library for the directory actually used
          try {
            await invoke('scan_music', { paths: [targetDir] });
          } catch (e) {
            console.warn('[PluginRuntime] Auto-rescan failed', e);
          }
          return savedPath;
        });

      case 'library.refresh':
        return refreshAll();

      case 'library.getTracks':
        return get(tracks);

      case 'library.getPlaylists':
        return get(playlists);

      case 'library.addExternalTrack':
        // args: [trackData: { title, artist, album?, duration?, cover_url?, source_type, external_id, format?, bitrate?, stream_url }]
        const trackData = args[0];
        if (!trackData || !trackData.title || !trackData.artist || !trackData.source_type || !trackData.external_id) {
          console.warn(`[PluginRuntime] Invalid external track data`);
          return null;
        }

        // Call Rust command to add external track
        return invoke('add_external_track', {
          track: {
            title: trackData.title,
            artist: trackData.artist,
            album: trackData.album || null,
            duration: trackData.duration || null,
            cover_url: trackData.cover_url || null,
            source_type: trackData.source_type,
            external_id: trackData.external_id,
            format: trackData.format || null,
            bitrate: trackData.bitrate || null,
            stream_url: trackData.stream_url || null  // The decoded stream URL
          }
        });

      case 'library.createPlaylist':
        // args: [name]
        return invoke('create_playlist', { name: args[0] });

      case 'library.addTrackToPlaylist':
        // args: [playlistId, trackId]
        if (typeof args[0] !== 'number' || typeof args[1] !== 'number') return false;
        return invoke('add_track_to_playlist', { playlistId: args[0], trackId: args[1] });

      case 'library.updatePlaylistCover':
        // args: [playlistId, coverUrl]
        if (typeof args[0] !== 'number') return false;
        return invoke('update_playlist_cover', { playlistId: args[0], coverUrl: args[1] || null });

      case 'settings.setDownloadLocation':
        // args: [path]
        try {
          const newPath = args[0] || null;
          if (typeof (appSettings as any).setDownloadLocation === 'function') {
            (appSettings as any).setDownloadLocation(newPath);
            return true;
          }
        } catch (err) {
          console.warn('[PluginRuntime] Failed to set download location', err);
        }
        return false;

      default:
        console.warn(`[PluginRuntime] Unknown host method: ${method}`);
        return null;
    }
  }

  // Get API surface for JS plugins
  private getPluginApi(pluginName: string): Record<string, any> {
    const plugin = this.plugins.get(pluginName);

    const api: Record<string, any> = {
      version: '1.0.0',
      pluginName
    };

    // Event system (always available)
    api.on = <K extends keyof import('./event-emitter').PluginEvents>(
      event: K,
      listener: EventListener
    ) => {
      if (!plugin) return;

      pluginEvents.on(event, listener);

      // Track listener for cleanup
      if (!plugin.eventListeners.has(event as string)) {
        plugin.eventListeners.set(event as string, []);
      }
      plugin.eventListeners.get(event as string)!.push(listener);
    };

    api.off = <K extends keyof import('./event-emitter').PluginEvents>(
      event: K,
      listener: EventListener
    ) => {
      if (!plugin) return;

      pluginEvents.off(event, listener);

      // Remove from tracked listeners
      const listeners = plugin.eventListeners.get(event as string);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
      }
    };

    api.once = <K extends keyof import('./event-emitter').PluginEvents>(
      event: K,
      listener: EventListener
    ) => {
      pluginEvents.once(event, listener);
    };

    if (this.hasPermission(pluginName, 'player:control')) {
      api.player = {
        play: () => this.callHost(pluginName, 'player.play'),
        pause: () => this.callHost(pluginName, 'player.pause'),
        seek: (time: number) => this.callHost(pluginName, 'player.seek', time),
        next: () => this.callHost(pluginName, 'player.next'),
        prev: () => this.callHost(pluginName, 'player.prev'),
        setTrack: (track: any) => this.callHost(pluginName, 'player.setTrack', track),
        addToQueue: (tracks: any[]) => this.callHost(pluginName, 'player.addToQueue', tracks),
        removeFromQueue: (index: number) => this.callHost(pluginName, 'player.removeFromQueue', index),
        reorderQueue: (from: number, to: number) => this.callHost(pluginName, 'player.reorderQueue', from, to),
        clearUpcoming: () => this.callHost(pluginName, 'player.clearUpcoming')
      };
    }

    if (this.hasPermission(pluginName, 'player:read')) {
      api.player = {
        ...api.player,
        getCurrentTime: () => this.callHost(pluginName, 'player.getCurrentTime'),
        getDuration: () => this.callHost(pluginName, 'player.getDuration'),
        isPlaying: () => this.callHost(pluginName, 'player.isPlaying'),
        getCurrentTrack: () => this.callHost(pluginName, 'player.getCurrentTrack'),
        getQueue: () => this.callHost(pluginName, 'player.getQueue')
      };
    }

    if (this.hasPermission(pluginName, 'storage:local')) {
      api.storage = {
        get: (key: string) => this.callHost(pluginName, 'storage.get', key),
        set: (key: string, value: any) => this.callHost(pluginName, 'storage.set', key, value)
      };
    }

    // Allow plugins to update certain app settings (download location)
    if (this.hasPermission(pluginName, 'settings:write') || this.hasPermission(pluginName, 'storage:local')) {
      api.settings = {
        setDownloadLocation: (path: string | null) => this.callHost(pluginName, 'settings.setDownloadLocation', path)
      };
    }

    if (this.hasPermission(pluginName, 'library:write')) {
      if (!api.library) api.library = {};
      api.library.downloadTrack = (options: any) => this.callHost(pluginName, 'library.downloadTrack', options);
      api.library.addExternalTrack = (trackData: any) => this.callHost(pluginName, 'library.addExternalTrack', trackData);
      api.library.refresh = () => this.callHost(pluginName, 'library.refresh');
      api.library.createPlaylist = (name: string) => this.callHost(pluginName, 'library.createPlaylist', name);
      api.library.addTrackToPlaylist = (playlistId: number, trackId: number) => this.callHost(pluginName, 'library.addTrackToPlaylist', playlistId, trackId);
      api.library.updatePlaylistCover = (playlistId: number, coverUrl: string | null) => this.callHost(pluginName, 'library.updatePlaylistCover', playlistId, coverUrl);
    }

    if (this.hasPermission(pluginName, 'library:read')) {
      if (!api.library) api.library = {};
      api.library.getTracks = () => this.callHost(pluginName, 'library.getTracks');
      api.library.getPlaylists = () => this.callHost(pluginName, 'library.getPlaylists');
    }

    if (this.hasPermission(pluginName, 'ui:inject')) {
      api.ui = {
        registerSlot: (slotName: UISlotName, element: HTMLElement, priority: number = 50) => {
          uiSlotManager.addContent(slotName, {
            pluginName,
            element,
            priority
          });
        },
        unregisterSlot: (slotName: UISlotName) => {
          uiSlotManager.removeContent(slotName, pluginName);
        }
      };
    }

    // Stream resolver registration (for external tracks like Tidal)
    // Plugins with player:control permission can register resolvers
    if (this.hasPermission(pluginName, 'player:control')) {
      api.stream = {
        // Register a resolver function for a source type (e.g., 'tidal')
        // Resolver: (externalId: string, options?: {quality?: string}) => Promise<string | null>
        registerResolver: (sourceType: string, resolver: (externalId: string, options?: any) => Promise<string | null>) => {
          this.streamResolvers.set(sourceType, resolver);
          console.log(`[PluginRuntime] Registered stream resolver for '${sourceType}' from plugin '${pluginName}'`);
        },
        unregisterResolver: (sourceType: string) => {
          this.streamResolvers.delete(sourceType);
        }
      };
    }

    // Network API - CORS-free fetch (always available for plugins with network:fetch permission)
    if (this.hasPermission(pluginName, 'network:fetch')) {
      api.fetch = async (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        try {
          const result = await invoke<{ status: number; headers: Record<string, string>; body: string }>('proxy_fetch', {
            request: {
              url,
              method: options?.method || 'GET',
              headers: options?.headers || null,
              body: options?.body || null
            }
          });

          // Return a Response-like object
          return {
            ok: result.status >= 200 && result.status < 300,
            status: result.status,
            headers: result.headers,
            text: async () => result.body,
            json: async () => JSON.parse(result.body)
          };
        } catch (error) {
          console.error(`[PluginRuntime] Fetch failed for ${pluginName}:`, error);
          throw error;
        }
      };
    }

    // Theme API (Always exposed to allow un-theming)
    api.theme = {
      refresh: () => {
        theme.initialize();
      }
    };

    // Discord Rich Presence API (always available)
    api.discord = {
      connect: async () => {
        try {
          return await invoke('discord_connect');
        } catch (error) {
          console.error('[PluginRuntime] Discord connect failed:', error);
          throw error;
        }
      },
      updatePresence: async (data: {
        song_title: string;
        artist: string;
        album?: string | null;
        cover_url?: string | null;
        current_time?: number;
        duration?: number;
        is_playing: boolean;
      }) => {
        try {
          return await invoke('discord_update_presence', { data });
        } catch (error) {
          console.error('[PluginRuntime] Discord update failed:', error);
          throw error;
        }
      },
      clearPresence: async () => {
        try {
          return await invoke('discord_clear_presence');
        } catch (error) {
          console.error('[PluginRuntime] Discord clear failed:', error);
          throw error;
        }
      },
      disconnect: async () => {
        try {
          return await invoke('discord_disconnect');
        } catch (error) {
          console.error('[PluginRuntime] Discord disconnect failed:', error);
          throw error;
        }
      },
      reconnect: async () => {
        try {
          return await invoke('discord_reconnect');
        } catch (error) {
          console.error('[PluginRuntime] Discord reconnect failed:', error);
          throw error;
        }
      }
    };

    return api;
  }

  // Main load function
  async loadPlugin(manifest: AudionPluginManifest): Promise<LoadedPlugin> {
    if (this.plugins.has(manifest.name)) {
      throw new Error(`Plugin already loaded: ${manifest.name}`);
    }

    let plugin: LoadedPlugin;

    if (manifest.type === 'js') {
      plugin = await this.loadJsPlugin(manifest);
    } else if (manifest.type === 'wasm') {
      plugin = await this.loadWasmPlugin(manifest);
    } else {
      throw new Error(`Unknown plugin type: ${(manifest as any).type}`);
    }

    this.plugins.set(manifest.name, plugin);
    this.config.onLoad?.(plugin);

    return plugin;
  }

  // Unload a plugin
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    // Remove all event listeners
    plugin.eventListeners.forEach((listeners, event) => {
      listeners.forEach(listener => {
        pluginEvents.off(event as any, listener);
      });
    });
    plugin.eventListeners.clear();

    // Remove all UI slot content
    uiSlotManager.removePluginContent(name);

    // Call destroy lifecycle hook
    if (plugin.manifest.type === 'wasm' && plugin.instance.destroy) {
      plugin.instance.destroy();
    } else if (plugin.manifest.type === 'js' && plugin.instance?.destroy) {
      plugin.instance.destroy();
    }

    // Remove script tag for JS plugins
    if (plugin.manifest.type === 'js') {
      const script = document.getElementById(`plugin-${name}`);
      script?.remove();
    }

    this.plugins.delete(name);
  }

  // Enable plugin
  enablePlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    plugin.enabled = true;

    if (plugin.instance?.start) {
      plugin.instance.start();
    }

    return true;
  }

  // Disable plugin
  disablePlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    plugin.enabled = false;

    if (plugin.instance?.stop) {
      plugin.instance.stop();
    }

    return true;
  }

  // Load all plugins from manifests
  async loadAll(manifests: AudionPluginManifest[]): Promise<void> {
    for (const manifest of manifests) {
      try {
        await this.loadPlugin(manifest);
      } catch (err) {
        this.config.onError?.(manifest.name, err as Error);
      }
    }
  }

  // Get all loaded plugins
  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  // Get a specific plugin
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  // Resolve stream URL for external tracks
  // Called by player.ts before playing a track with source_type != 'local'
  async resolveStreamUrl(sourceType: string, externalId: string, options?: any): Promise<string | null> {
    const resolver = this.streamResolvers.get(sourceType);
    if (!resolver) {
      console.warn(`[PluginRuntime] No stream resolver registered for source type '${sourceType}'`);
      return null;
    }

    try {
      console.log(`[PluginRuntime] Resolving stream URL for ${sourceType}://${externalId}`);
      const url = await resolver(externalId, options);
      console.log(`[PluginRuntime] Resolved stream URL:`, url ? url.substring(0, 50) + '...' : 'null');
      return url;
    } catch (error) {
      console.error(`[PluginRuntime] Failed to resolve stream URL:`, error);
      return null;
    }
  }
}
