package com.audion.app

import android.content.Context
import android.net.Uri
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * bridge between the android auto browse tree and the rust library layer
 * calls straight into rust via jni (see src-tauri/src/android_auto/jni_bridge.rs),
 * bypassing the webview/js hop entirely so browsing keeps working even if
 * the webview is suspended or the activity was torn down while auto is
 * driving the session
 */
object AudionLibraryBridge {

    // sentinel for the top of the browse tree, passed to getChildren() by onGetRoot
    const val ROOT_ID = "root"

    // native exports, defined in src-tauri/src/android_auto/jni_bridge.rs
    // the audion_lib .so is loaded in AudionApplication.onCreate before any
    // component (activity or service) can reach these
    @JvmStatic private external fun getChildrenNative(nodeId: String): String
    @JvmStatic private external fun getItemNative(nodeId: String): String
    @JvmStatic private external fun searchNative(scope: String, query: String): String

    /**
     * returns the browsable/playable children of a given node id
     * called for ROOT_ID first, then again for whatever ids those children expose
     */
    fun getChildren(context: Context, parentId: String): List<MediaItem> {
        val json = safeNativeCall("[]") { getChildrenNative(parentId) }
        return parseNodes(context, json)
    }

    /**
     * resolves a single track id to a description, used when auto/bluetooth
     * asks to play a specific id directly rather than browsing to it
     */
    fun getItem(context: Context, mediaId: String): MediaDescriptionCompat? {
        val json = safeNativeCall("null") { getItemNative(mediaId) }
        if (json == "null") return null
        return try {
            trackDescription(context, mediaId, JSONObject(json))
        } catch (e: Exception) {
            null
        }
    }

    /** scope is one of "tracks" / "albums" / "artists" / "playlists" */
    fun search(context: Context, scope: String, query: String): List<MediaItem> {
        val json = safeNativeCall("[]") { searchNative(scope, query) }
        return parseNodes(context, json)
    }

    /** the .so may not be loaded yet in rare cold-start races => fail closed, not crash */
    private inline fun safeNativeCall(fallback: String, call: () -> String): String {
        return try {
            call()
        } catch (e: UnsatisfiedLinkError) {
            fallback
        } catch (e: Exception) {
            fallback
        }
    }

    private fun parseNodes(context: Context, json: String): List<MediaItem> {
        val array = try {
            JSONArray(json)
        } catch (e: Exception) {
            return emptyList()
        }

        val items = mutableListOf<MediaItem>()
        for (i in 0 until array.length()) {
            val node = array.optJSONObject(i) ?: continue
            val descriptionBuilder = MediaDescriptionCompat.Builder()
                .setMediaId(node.optString("id"))
                .setTitle(node.optString("title"))

            if (node.has("subtitle") && !node.isNull("subtitle")) {
                descriptionBuilder.setSubtitle(node.getString("subtitle"))
            }
            resolveArtUri(context, node.optString("art_path", null))?.let {
                descriptionBuilder.setIconUri(it)
            }

            val browsable = node.optBoolean("browsable", false)
            val flag = if (browsable) MediaItem.FLAG_BROWSABLE else MediaItem.FLAG_PLAYABLE
            items.add(MediaItem(descriptionBuilder.build(), flag))
        }
        return items
    }

    private fun trackDescription(context: Context, mediaId: String, track: JSONObject): MediaDescriptionCompat {
        val builder = MediaDescriptionCompat.Builder()
            .setMediaId(mediaId)
            .setTitle(track.optString("title", "Unknown Title"))
            .setSubtitle(track.optString("artist", null))

        val artPath = track.optString("track_cover_path", null) ?: track.optString("cover_url", null)
        resolveArtUri(context, artPath)?.let { builder.setIconUri(it) }

        return builder.build()
    }

    /**
     * auto's chrome runs in a separate system process => it can't load images through tauri's asset:// webview protocol 
     * so local paths need a real content:// uri via the FileProvider already declared in the manifest
     * (see res/xml/file_paths.xml => covers live under the app's internal
     * data dir, exposed there as the "covers" files-path root)
     * remote http(s) urls pass through unchanged
     */
    private fun resolveArtUri(context: Context, path: String?): Uri? {
        if (path.isNullOrEmpty()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) {
            return Uri.parse(path)
        }
        return try {
            val file = File(path)
            if (!file.exists()) return null
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        } catch (e: Exception) {
            null
        }
    }
}
