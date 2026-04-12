import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { authState, triggerSync, isLoggedIn } from '$lib/stores/sync';

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
}

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

function createWebsocketStore() {
    const { subscribe, set, update } = writable<{
        connected: boolean;
        devices: RemoteDevice[];
    }>({
        connected: false,
        devices: []
    });

    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = INITIAL_RECONNECT_DELAY;
    let deviceId: string | null = null;

    async function connect() {
        if (socket || !get(isLoggedIn)) return;

        try {
            const serverUrl = await invoke<string>('sync_get_server_url');
            const token = await invoke<string | null>('sync_get_access_token');
            deviceId = await invoke<string>('sync_get_device_id');

            if (!token) return;

            // Convert http/https to ws/wss
            const wsUrl = serverUrl.replace(/^http/, 'ws') + `?token=${token}`;
            
            socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                console.log('[WS] Connected to sync server');
                update(s => ({ ...s, connected: true }));
                reconnectDelay = INITIAL_RECONNECT_DELAY;
                
                // Identify this device
                const deviceName = "Desktop Player"; // We can make this configurable later
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

            socket.onclose = () => {
                console.log('[WS] Disconnected');
                update(s => ({ ...s, connected: false }));
                socket = null;
                scheduleReconnect();
            };

            socket.onerror = (err) => {
                console.error('[WS] Error:', err);
            };

        } catch (err) {
            console.error('[WS] Connection failed:', err);
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
                update(s => ({ ...s, devices: payload.devices.filter((d: any) => d.deviceId !== deviceId) }));
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
        set({ connected: false, devices: [] });
    }

    // Auto connect/disconnect based on auth state
    authState.subscribe($auth => {
        if ($auth.is_logged_in) {
            connect();
        } else {
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
