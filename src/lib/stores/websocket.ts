import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { authState, triggerSync, isLoggedIn } from '$lib/stores/sync';
import { appSettings } from '$lib/stores/settings';

export interface RemoteDevice {
    deviceId: string;
    deviceName: string;
    lastSeen: number;
    playerState?: RemotePlayerState;
}

export interface RemotePlayerState {
    track: {
        id: string;
        title: string;
        artist: string;
        album: string;
        coverUrl: string;
    } | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    shuffle: boolean;
    repeat: 'none' | 'one' | 'all';
}

export const activeRemoteDevice = writable<string | null>(null);

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

function createWebsocketStore() {
    const { subscribe, set, update } = writable<{
        connected: boolean;
        devices: RemoteDevice[];
        statusText: string;
    }>({
        connected: false,
        devices: [],
        statusText: 'Connecting...'
    });

    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = INITIAL_RECONNECT_DELAY;
    let deviceId: string | null = null;

    async function connect() {
        if (socket || !get(isLoggedIn)) return;

        try {
            update(s => ({ ...s, statusText: 'Authenticating...' }));
            const serverUrl = await invoke<string>('sync_get_server_url');
            const token = await invoke<string | null>('sync_get_access_token');
            deviceId = await invoke<string>('sync_get_device_id');

            if (!token) {
                console.log('[WS] Cannot connect: No access token available');
                update(s => ({ ...s, statusText: 'No access token available' }));
                scheduleReconnect(); // We should retry just in case it's loading
                return;
            }

            // Convert http/https to ws/wss
            const wsUrl = serverUrl.replace(/^http/, 'ws') + `?token=${token}`;
            console.log(`[WS] Connecting to ${wsUrl.substring(0, 50)}...`);
            update(s => ({ ...s, statusText: 'Establishing real-time connection...' }));
            
            socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                console.log('[WS] Connected successfully');
                update(s => ({ ...s, connected: true, statusText: 'Real-time sync active' }));
                reconnectDelay = INITIAL_RECONNECT_DELAY;
                
                let deviceName = "Unknown Device";
                if (typeof window !== 'undefined') {
                    const isMobileDev = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    deviceName = isMobileDev ? "Mobile Player" : "Desktop Player";
                }
                
                send('identify', { deviceId, deviceName });
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    handleMessage(message);
                } catch (err) {
                    console.error('[WS] Failed to parse message:', err);
                }
            };

            socket.onclose = (event) => {
                const wasClean = event.wasClean;
                const code = event.code;
                const reason = event.reason;
                console.log(`[WS] Closed. Clean: ${wasClean}, Code: ${code}, Reason: ${reason}`);
                
                update(s => ({ ...s, connected: false, statusText: 'Connection closed' }));
                socket = null;
                scheduleReconnect();
            };

            socket.onerror = (err) => {
                console.error('[WS] Connection error event:', err);
            };

        } catch (err) {
            console.error('[WS] Connection failed:', err);
            update(s => ({ ...s, statusText: `Connection failed: ${err}` }));
            scheduleReconnect();
        }
    }

    const messageHandlers: Set<(type: string, payload: any) => void> = new Set();

    function handleMessage(message: any) {
        const { type, payload } = message;

        switch (type) {
            case 'sync_notify':
                console.log('[WS] Sync notification received');
                triggerSync(false);
                break;
            
            case 'devices_update':
                update(s => {
                    // Filter out own device and ensure unique IDs
                    const uniqueDevices = payload.devices.reduce((acc: RemoteDevice[], current: RemoteDevice) => {
                        if (current.deviceId === deviceId) return acc;
                        if (!acc.find(item => item.deviceId === current.deviceId)) {
                            acc.push(current);
                        }
                        return acc;
                    }, []);
                    
                    return { ...s, devices: uniqueDevices };
                });
                break;

            case 'player_state':
                update(s => {
                    const devices = s.devices.map(d => {
                        if (d.deviceId === payload.deviceId) {
                            return { ...d, playerState: payload };
                        }
                        return d;
                    });
                    return { ...s, devices };
                });
                break;
            
            case 'pong':
                // Heartbeat handled by browser automatically
                break;
        }

        // Notify registered handlers
        for (const handler of messageHandlers) {
            handler(type, payload);
        }
    }

    function onMessage(handler: (type: string, payload: any) => void) {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
    }

    function scheduleReconnect() {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (!get(isLoggedIn)) return;

        reconnectTimeout = setTimeout(() => {
            console.log(`[WS] Attempting reconnect in ${reconnectDelay}ms...`);
            connect();
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        }, reconnectDelay);
        update(s => ({ ...s, statusText: `Reconnecting in ${Math.ceil(reconnectDelay/1000)}s...` }));
    }

    function send(type: string, payload: any) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, payload }));
        }
    }

    function disconnect() {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (socket) {
            socket.close();
            socket = null;
        }
        set({ connected: false, devices: [], statusText: 'Disconnected' });
    }

    // Auto connect/disconnect based on auth state and settings
    authState.subscribe($auth => {
        if ($auth.is_logged_in && get(appSettings).remoteControlEnabled) {
            connect();
        } else {
            disconnect();
        }
    });

    appSettings.subscribe($settings => {
        if ($settings.remoteControlEnabled && get(authState).is_logged_in) {
            connect();
        } else if (!$settings.remoteControlEnabled) {
            disconnect();
        }
    });

    return {
        subscribe,
        send,
        connect,
        disconnect,
        onMessage,
        getDeviceId: () => deviceId
    };
}

export const wsStore = createWebsocketStore();
