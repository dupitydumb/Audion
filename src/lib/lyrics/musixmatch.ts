/**
 * Musixmatch LRC provider
 * For fetching synced and word-by-word lyrics
 * Uses Tauri backend to avoid CORS issues
 */

import { invoke } from '@tauri-apps/api/core';

export class Musixmatch {
    private lang: string | null;
    private enhanced: boolean;
    private token: string | null = null;
    private tokenRetryCount = 0;
    private maxTokenRetries = 3;

    constructor(lang: string | null = null, enhanced = false) {
        this.lang = lang;
        this.enhanced = enhanced;
    }

    private async _get(action: string, query: [string, string][] = []): Promise<any> {
        if (action !== "token.get" && this.token === null) {
            await this._getToken();
        }

        const params: [string, string][] = [...query];

        if (this.token !== null) {
            params.push(["usertoken", this.token]);
        }

        // Use Tauri backend to make the request (avoids CORS)
        const responseText = await invoke<string>('musixmatch_request', {
            action,
            params
        });

        return JSON.parse(responseText);
    }

    private async _getToken(): Promise<void> {
        const tokenKey = "musixmatch_token";
        const expirationKey = "musixmatch_expiration";
        const currentTime = Math.floor(Date.now() / 1000);

        // Check for cached token first
        const cachedToken = localStorage.getItem(tokenKey);
        const expirationTime = parseInt(localStorage.getItem(expirationKey) || "0");

        if (cachedToken && expirationTime && currentTime < expirationTime) {
            this.token = cachedToken;
            return;
        }

        const data = await this._get("token.get", [["user_language", "en"]]);

        if (data.message.header.status_code === 401) {
            localStorage.removeItem(tokenKey);
            localStorage.removeItem(expirationKey);
            this.token = null;
            this.tokenRetryCount++;

            if (this.tokenRetryCount >= this.maxTokenRetries) {
                this.tokenRetryCount = 0;
                throw new Error('Musixmatch token fetch failed after max retries');
            }

            await new Promise(resolve => setTimeout(resolve, 10000));
            return this._getToken();
        }

        this.tokenRetryCount = 0;

        if (!data.message.body || !data.message.body.user_token) {
            throw new Error('Failed to get Musixmatch token');
        }

        const newToken = data.message.body.user_token;
        const newExpirationTime = currentTime + 600;

        this.token = newToken;
        localStorage.setItem(tokenKey, newToken);
        localStorage.setItem(expirationKey, String(newExpirationTime));
    }

    clearToken(): void {
        localStorage.removeItem("musixmatch_token");
        localStorage.removeItem("musixmatch_expiration");
        this.token = null;
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }

    async getLrcById(trackId: string, retryOnAuth = true): Promise<{ synced: string } | null> {
        try {
            const data = await this._get("track.subtitle.get", [
                ["track_id", trackId],
                ["subtitle_format", "lrc"]
            ]);

            if (data.message.header.status_code === 401) {
                this.clearToken();
                if (retryOnAuth) {
                    return this.getLrcById(trackId, false);
                }
                return null;
            }

            const body = data.message.body;
            if (!body || !body.subtitle || !body.subtitle.subtitle_body) {
                return null;
            }

            return { synced: body.subtitle.subtitle_body };
        } catch (error) {
            console.warn(`[Musixmatch] getLrcById failed for trackId=${trackId}:`, error);
            return null;
        }
    }

    async getLrcWordByWord(trackId: string, retryOnAuth = true): Promise<{ synced: string | null }> {
        try {
            const data = await this._get("track.richsync.get", [["track_id", trackId]]);

            if (data.message.header.status_code === 401) {
                this.clearToken();
                if (retryOnAuth) {
                    return this.getLrcWordByWord(trackId, false);
                }
                return { synced: null };
            }

            if (data.message.header.status_code === 200 &&
                data.message.body?.richsync?.richsync_body) {
                const lrcRaw = JSON.parse(data.message.body.richsync.richsync_body);
                let lrcStr = "";

                for (const item of lrcRaw) {
                    lrcStr += `[${this.formatTime(item.ts)}] `;
                    for (const l of item.l) {
                        const t = this.formatTime(parseFloat(item.ts) + parseFloat(l.o));
                        lrcStr += `<${t}> ${l.c} `;
                    }
                    lrcStr += "\n";
                }

                return { synced: lrcStr };
            }
        } catch (error) {
            console.warn(`[Musixmatch] getLrcWordByWord failed for trackId=${trackId}:`, error);
        }
        return { synced: null };
    }

    async getLrc(searchTerm: string, retryOnAuth = true): Promise<{ synced: string } | null> {

        try {
            const data = await this._get("track.search", [
                ["q", searchTerm],
                ["page_size", "5"],
                ["page", "1"]
            ]);

            const statusCode = data.message.header.status_code;

            if (statusCode === 401) {
                this.clearToken();
                if (retryOnAuth) {
                    return this.getLrc(searchTerm, false);
                }
                return null;
            }

            if (statusCode !== 200) {
                return null;
            }

            const tracks = data.message.body?.track_list;
            if (!tracks || tracks.length === 0) {
                return null;
            }

            // Take first result
            const track = tracks[0];
            const trackId = String(track.track.track_id);

            if (this.enhanced) {
                const lrc = await this.getLrcWordByWord(trackId);
                if (lrc && lrc.synced) {
                    return { synced: lrc.synced };
                }
            }

            return this.getLrcById(trackId);
        } catch (error) {
            console.warn(`[Musixmatch] getLrc failed for searchTerm="${searchTerm}":`, error);
            return null;
        }
    }
}
