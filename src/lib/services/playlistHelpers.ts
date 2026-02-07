// Helper for batch adding tracks to a playlist
import { addTrackToPlaylist } from '$lib/api/tauri';

export interface BatchAddResult {
    success: number;
    failed: number;
    errors: string[];
}

/**
 * Add multiple tracks to a playlist sequentially
 */
export async function addTracksToPlaylist(
    playlistId: number,
    trackIds: number[]
): Promise<BatchAddResult> {
    const result: BatchAddResult = {
        success: 0,
        failed: 0,
        errors: [],
    };

    for (const trackId of trackIds) {
        try {
            await addTrackToPlaylist(playlistId, trackId);
            result.success++;
        } catch (error) {
            result.failed++;
            result.errors.push(`Failed to add track ${trackId}: ${error}`);
            console.error(`Failed to add track ${trackId}:`, error);
        }
    }

    return result;
}