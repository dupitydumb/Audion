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
import { PluginStorage } from './plugin-storage';
import { RateLimiter, RATE_LIMITS } from './rate-limiter';
import type { EventListener } from './event-emitter';
import { uiSlotManager, type UISlotName } from './ui-slots';

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

      case 'player.clearUpcoming':
        clearUpcoming();
        return true;

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
}
