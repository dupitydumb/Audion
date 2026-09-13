package com.audion.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.MediaBrowserServiceCompat.BrowserRoot
import androidx.media.MediaBrowserServiceCompat.Result
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.utils.MediaConstants
import java.net.URL
import org.json.JSONObject
import kotlinx.coroutines.*

/**
 * foreground service for persistent media notification with playback controls
 * shows track title, artist, album art, and play/pause/next/prev buttons,
 * similar to spotify's media notification
 *
 * also acts as the media browser service for android auto / aaos / bluetooth
 * avrcp browsing => this is the same service google's own samples use for
 * both roles, since auto needs the session token this service already owns
 */
class MediaNotificationService : MediaBrowserServiceCompat(), AudionLibraryBridge.NativeNotificationCallback {

    companion object {
        const val CHANNEL_ID = "audion_media_channel"
        const val NOTIFICATION_ID = 1001
        private const val TAG = "AudionNotif"

        const val ACTION_PLAY_PAUSE = "com.audion.app.PLAY_PAUSE"
        const val ACTION_PREVIOUS = "com.audion.app.PREVIOUS"
        const val ACTION_NEXT = "com.audion.app.NEXT"
        const val ACTION_LOVE = "com.audion.app.LOVE"
        const val ACTION_STOP = "com.audion.app.STOP"

        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val EXTRA_IS_LOVED = "is_loved"
        const val EXTRA_ART_URL = "art_url"
        const val EXTRA_CURRENT_TIME = "current_time"
        const val EXTRA_DURATION = "duration"
        const val EXTRA_IS_SHUFFLED = "is_shuffled"
        const val EXTRA_REPEAT_MODE = "repeat_mode"

        // Reference to the WebView for evaluating JS commands
        var webViewRef: WebView? = null

        // mirrors the isPlaying the frontend last reported via onStartCommand's metadata update => 
        // needed because ACTION_PLAY_PAUSE (unlike MediaSessionCompat.Callback's onPlay()/onPause())
        // doesn't know which direction to flip without this
        // note: the very first notification tap after a cold play could pick the wrong direction
        private var lastKnownIsPlaying = false
    }

    private var mediaSession: MediaSessionCompat? = null
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var currentArtBitmap: Bitmap? = null
    private var currentArtUrl: String? = null

    // merged "last known" state, kept up to date by both the js driven path
    // (onStartCommand's else branch) and the native path
    // (onNativeAudioEvent) => whichever fires most recently wins
    // a native trackChanged event reuses whatever was last known
    private var currentTitle = "Unknown Title"
    private var currentArtist = "Unknown Artist"
    private var currentAlbum = ""
    private var currentIsLoved = false
    private var currentIsShuffled = false
    private var currentRepeatMode = "none"
    private var currentDurationSecs: Double? = null
    private var currentPositionSecs: Double = 0.0

    // not readable by that other process until we explicitly grant it read access for exactly this package
    // onGetRoot is called once per client connection, before any onLoadChildren/onSearch
    // call from that client, so caching it here is safe
    private var browsingClientPackageName: String? = null

    // no manual onBind override => MediaBrowserServiceCompat's own implementation
    // handles the browse binding protocol auto/aaos/bluetooth avrcp clients use

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        setupMediaSession()
        // exposes the session to browsing clients, required for MediaBrowserServiceCompat
        sessionToken = mediaSession?.sessionToken
        // native (rust) -> kotlin notification sync, 
        // see onNativeAudioEvent
        // this needs to happen even if the webview never comes up
        AudionLibraryBridge.registerNotificationCallback(this)
    }

    /**
     * AudionLibraryBridge.NativeNotificationCallback
     * (see notify_track_changed/notify_position/notify_playing_state in jni_bridge.rs)
     * on whichever native thread produced the event, => hop over before touching mediaSession/notification apis
     */
    override fun onNativeAudioEvent(json: String) {
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        handler.post {
            try {
                val obj = JSONObject(json)
                when (obj.optString("type")) {
                    "trackChanged" -> {
                        currentTitle = obj.optString("title", "Unknown Title")
                        currentArtist = obj.optString("artist", "Unknown Artist")
                        currentAlbum = obj.optString("album", "")
                        currentDurationSecs = if (obj.has("durationSecs") && !obj.isNull("durationSecs")) {
                            obj.optDouble("durationSecs")
                        } else {
                            null
                        }
                        currentPositionSecs = 0.0
                        lastKnownIsPlaying = obj.optBoolean("isPlaying", true)
                        // local paths need the file:// scheme added
                        val artPath = if (obj.isNull("artPath")) null else obj.optString("artPath", null)
                        val artUrlForNotification = when {
                            artPath.isNullOrEmpty() -> null
                            artPath.startsWith("http://") || artPath.startsWith("https://") || artPath.startsWith("file://") -> artPath
                            else -> "file://$artPath"
                        }
                        // art changed => force a reload by clearing the cached bitmap/url
                        if (artUrlForNotification != currentArtUrl) {
                            currentArtBitmap = null
                        }
                        applyNotificationState(artUrlForNotification)
                    }
                    "position" -> {
                        currentPositionSecs = obj.optDouble("positionSecs", currentPositionSecs)
                        applyNotificationState(null)
                    }
                    "playbackState" -> {
                        lastKnownIsPlaying = obj.optBoolean("isPlaying", lastKnownIsPlaying)
                        applyNotificationState(null)
                    }
                    else -> {
                        Log.w(TAG, "onNativeAudioEvent: unknown type in $json")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "onNativeAudioEvent: failed to parse $json", e)
            }
        }
    }

    private fun applyNotificationState(artUrlOverride: String?) {
        updateNotification(
            currentTitle,
            currentArtist,
            currentAlbum,
            lastKnownIsPlaying,
            currentIsLoved,
            artUrlOverride,
            formatSecondsForNotification(currentPositionSecs),
            currentDurationSecs?.let { formatSecondsForNotification(it) },
            currentIsShuffled,
            currentRepeatMode
        )
    }

    /** updateNotification expects currentTime/duration as the same string format onStartCommand's EXTRA_CURRENT_TIME/EXTRA_DURATION already use */
    private fun formatSecondsForNotification(totalSeconds: Double): String {
        val total = totalSeconds.toLong().coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%d:%02d", m, s)
    }

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?
    ): BrowserRoot {
        // rootHints/clientPackageName let us vary the tree per caller later
        // (e.g. a slimmer tree for bluetooth avrcp vs full for auto) (not needed yet)
        //
        // also cached so 
        // onLoadChildren/onSearch know who to grant iconUri read access to
        // (see browsingClientPackageName above)
        browsingClientPackageName = clientPackageName
        val extras = Bundle().apply {
            putBoolean(MediaConstants.BROWSER_SERVICE_EXTRAS_KEY_SEARCH_SUPPORTED, true)
        }
        return BrowserRoot(AudionLibraryBridge.ROOT_ID, extras)
    }

    override fun onLoadChildren(parentId: String, result: Result<List<MediaItem>>) {
        // detach because the bridge call may not resolve synchronously
        result.detach()
        serviceScope.launch {
            val children = AudionLibraryBridge.getChildren(applicationContext, parentId)
            grantArtUriPermissions(children)
            withContext(Dispatchers.Main) {
                result.sendResult(children)
            }
        }
    }

    override fun onSearch(query: String, extras: Bundle?, result: Result<List<MediaItem>>) {
        // auto's search box has no concept of our 4 library chips (tracks/
        // albums/artists/playlists) => query every scope and merge, capped
        // to a single reasonable list length rather than 4x the per-scope limit
        result.detach()
        serviceScope.launch {
            val merged = listOf("tracks", "albums", "artists", "playlists")
                .flatMap { scope -> AudionLibraryBridge.search(applicationContext, scope, query) }
                .take(30)
            grantArtUriPermissions(merged)
            withContext(Dispatchers.Main) {
                result.sendResult(merged)
            }
        }
    }

    /**
     * our FileProvider is exported="false",
     * so every content:// iconUri we hand back
     * has to be explicitly granted to the browsing client
     */
    private fun grantArtUriPermissions(items: List<MediaItem>) {
        val clientPackageName = browsingClientPackageName ?: return
        for (item in items) {
            val iconUri = item.description.iconUri ?: continue
            if (iconUri.scheme == "content") {
                try {
                    grantUriPermission(
                        clientPackageName,
                        iconUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                } catch (e: SecurityException) {
                    Log.w(TAG, "failed to grant art uri permission for $iconUri to $clientPackageName", e)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> {
                evaluateJs("window.__audionMediaAction?.('playPause')")
                // fallback for when the notification's own buttons are tapped
                // flip based on the last state the frontend reported
                if (lastKnownIsPlaying) AudionLibraryBridge.pause() else AudionLibraryBridge.resume()
            }
            ACTION_PREVIOUS -> {
                evaluateJs("window.__audionMediaAction?.('previous')")
                AudionLibraryBridge.previous()
            }
            ACTION_NEXT -> {
                evaluateJs("window.__audionMediaAction?.('next')")
                AudionLibraryBridge.next()
            }
            ACTION_LOVE -> {
                evaluateJs("window.__audionMediaAction?.('love')")
                // no JNI fallback: love/like has no native export
                // so this action is webview only for now
            }
            ACTION_STOP -> {
                evaluateJs("window.__audionMediaAction?.('stop')")
                AudionLibraryBridge.stop()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                // Update notification with metadata from intent
                val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Unknown Title"
                val artist = intent?.getStringExtra(EXTRA_ARTIST) ?: "Unknown Artist"
                val album = intent?.getStringExtra(EXTRA_ALBUM) ?: ""
                val isPlaying = intent?.getBooleanExtra(EXTRA_IS_PLAYING, false) ?: false
                lastKnownIsPlaying = isPlaying
                val isLoved = intent?.getBooleanExtra(EXTRA_IS_LOVED, false) ?: false
                val artUrl = intent?.getStringExtra(EXTRA_ART_URL)
                val currentTime = intent?.getStringExtra(EXTRA_CURRENT_TIME) ?: null
                val duration = intent?.getStringExtra(EXTRA_DURATION) ?: null
                val isShuffled = intent?.getBooleanExtra(EXTRA_IS_SHUFFLED, false) ?: false
                val repeatMode = intent?.getStringExtra(EXTRA_REPEAT_MODE) ?: "none"

                // keep the shared last known state (see field doc comments) in sync with whatever the js side just reported
                // so a native side event arriving later 
                // (position tick, playbackState flip) merges against real values
                currentTitle = title
                currentArtist = artist
                currentAlbum = album
                currentIsLoved = isLoved
                currentIsShuffled = isShuffled
                currentRepeatMode = repeatMode
                parseTimeToMillis(currentTime)?.let { currentPositionSecs = it / 1000.0 }
                currentDurationSecs = parseTimeToMillis(duration)?.let { it / 1000.0 }

                Log.d(TAG, "onStartCommand: title=$title artUrl=${artUrl?.let { it.take(80) + if (it.length > 80) "..." else "" }} (len=${artUrl?.length ?: 0}, prefix=${artUrl?.take(16)})")

                updateNotification(title, artist, album, isPlaying, isLoved, artUrl, currentTime, duration, isShuffled, repeatMode)
            }
        }

        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows current playing track with controls"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "AudionMediaSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )

            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    evaluateJs("window.__audionMediaAction?.('playPause')")
                    lastKnownIsPlaying = true
                    AudionLibraryBridge.resume()
                }
                override fun onPause() {
                    evaluateJs("window.__audionMediaAction?.('playPause')")
                    lastKnownIsPlaying = false
                    AudionLibraryBridge.pause()
                }
                override fun onSkipToPrevious() {
                    evaluateJs("window.__audionMediaAction?.('previous')")
                    AudionLibraryBridge.previous()
                }
                override fun onSkipToNext() {
                    evaluateJs("window.__audionMediaAction?.('next')")
                    AudionLibraryBridge.next()
                }
                override fun onStop() {
                    evaluateJs("window.__audionMediaAction?.('stop')")
                    AudionLibraryBridge.stop()
                    stopSelf()
                }
                override fun onSeekTo(pos: Long) {
                    AudionLibraryBridge.seek(pos / 1000.0)
                }
                override fun onSetShuffleMode(shuffleMode: Int) {
                    // the frontend only exposes a toggle, not "set to this exact
                    // mode" => each tap just flips current state
                    evaluateJs("window.__audionMediaAction?.('toggleShuffle')")
                    AudionLibraryBridge.setShuffle(shuffleMode != PlaybackStateCompat.SHUFFLE_MODE_NONE)
                }
                override fun onSetRepeatMode(repeatMode: Int) {
                    // same deal as shuffle, but cycling none -> one -> all -> none
                    evaluateJs("window.__audionMediaAction?.('cycleRepeat')")
                    val mode = when (repeatMode) {
                        PlaybackStateCompat.REPEAT_MODE_ONE -> "one"
                        PlaybackStateCompat.REPEAT_MODE_ALL, PlaybackStateCompat.REPEAT_MODE_GROUP -> "all"
                        else -> "none"
                    }
                    AudionLibraryBridge.setRepeat(mode)
                }
                override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
                    // fired when a track is tapped in auto's browse/search ui
                    // (not onPlay() => that's only for the transport play button)
                    // validate against our own "track:<id>" scheme before it ever reaches evaluateJs,
                    //  since this string becomes
                    // literal js source below
                    if (mediaId == null || !mediaId.matches(Regex("^track:\\d+$"))) {
                        return
                    }
                    evaluateJs("window.__audionPlayTrackId?.('$mediaId')")
                    // starting a track from auto's browse/search ui also starts playback
                    lastKnownIsPlaying = true
                    AudionLibraryBridge.playTrack(mediaId)
                }
            })

            isActive = true
        }
    }

    private fun updateNotification(
        title: String,
        artist: String,
        album: String,
        isPlaying: Boolean,
        isLoved: Boolean,
        artUrl: String?,
        currentTime: String?,
        duration: String?,
        isShuffled: Boolean,
        repeatMode: String
    ) {
        // Update media session metadata
        val durationMs = parseTimeToMillis(duration)
        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)

        // only claim a duration when we actually parsed one => auto/wear/lock-screen
        // progress bars read this, leaving it unset is safer than reporting 0
        if (durationMs != null) {
            metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
        }

        currentArtBitmap?.let {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
        }

        mediaSession?.setMetadata(metadataBuilder.build())

        // shuffle/repeat live on the session itself, not the playback state =>
        // this drives auto/aaos's shuffle/repeat icon highlight state
        mediaSession?.setShuffleMode(
            if (isShuffled) PlaybackStateCompat.SHUFFLE_MODE_ALL else PlaybackStateCompat.SHUFFLE_MODE_NONE
        )
        mediaSession?.setRepeatMode(repeatModeToCompat(repeatMode))

        // Update playback state with transport controls.
        val positionMs = parseTimeToMillis(currentTime) ?: PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
        val stateBuilder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE or
                PlaybackStateCompat.ACTION_SET_REPEAT_MODE
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                positionMs,
                1f
            )

        mediaSession?.setPlaybackState(stateBuilder.build())

        // Load album art asynchronously if URL changed
        Log.d(TAG, "updateNotification: artUrl=${artUrl?.take(60)} currentArtUrl=${currentArtUrl?.take(60)} changed=${artUrl != currentArtUrl} hasBitmap=${currentArtBitmap != null}")

        if (artUrl != null && artUrl != currentArtUrl && artUrl.isNotEmpty()) {
            currentArtUrl = artUrl
            serviceScope.launch {
                try {
                    Log.d(TAG, "Loading art from: ${artUrl.take(120)}")
                    val bitmap = loadBitmap(artUrl)
                    if (bitmap != null) {
                        Log.d(TAG, "Art loaded successfully: ${bitmap.width}x${bitmap.height}")
                        currentArtBitmap = bitmap
                        // Re-update with the loaded bitmap
                        withContext(Dispatchers.Main) {
                            updateNotification(title, artist, album, isPlaying, isLoved, null, currentTime, duration, isShuffled, repeatMode)
                        }
                    } else {
                        Log.w(TAG, "Art load returned null bitmap for url: ${artUrl.take(120)}")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Art loading failed for url: ${artUrl.take(120)}", e)
                }
            }
        }

        // Build notification
        val notification = buildNotification(title, artist, album, isPlaying, isLoved, currentTime, duration)
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(
        title: String,
        artist: String,
        album: String,
        isPlaying: Boolean,
        isLoved: Boolean,
        currentTime: String?,
        duration: String?
    ): Notification {
        Log.d(TAG, "buildNotification: smallIcon=R.drawable.ic_notification hasLargeIconBitmap=${currentArtBitmap != null}${currentArtBitmap?.let { " (${it.width}x${it.height})" } ?: ""}")

        // Intent to open the app when notification is tapped
        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        // Action intents
        val loveIntent = PendingIntent.getService(
            this, 0,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_LOVE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val previousIntent = PendingIntent.getService(
            this, 1,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_PREVIOUS },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPauseIntent = PendingIntent.getService(
            this, 2,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_PLAY_PAUSE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nextIntent = PendingIntent.getService(
            this, 3,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this, 4,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val timeInfo = if (!currentTime.isNullOrEmpty() && !duration.isNullOrEmpty()) {
            "$currentTime / $duration"
        } else ""

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(if (timeInfo.isNotEmpty()) "$album  •  $timeInfo" else album)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(contentIntent)
            .setDeleteIntent(stopIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(
                R.drawable.ic_skip_previous,
                "Previous",
                previousIntent
            )
            .addAction(
                if (isLoved) R.drawable.ic_heart_filled else R.drawable.ic_heart,
                "Love",
                loveIntent
            )
            .addAction(
                if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play,
                if (isPlaying) "Pause" else "Play",
                playPauseIntent
            )
            .addAction(
                R.drawable.ic_skip_next,
                "Next",
                nextIntent
            )
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 2, 3) // previous, play/pause, next
                    .setShowCancelButton(true)
                    .setCancelButtonIntent(stopIntent)
            )

        currentArtBitmap?.let {
            builder.setLargeIcon(it)
            Log.d(TAG, "buildNotification: setLargeIcon applied (${it.width}x${it.height})")
        } ?: Log.d(TAG, "buildNotification: no largeIcon set (currentArtBitmap is null)")

        return builder.build()
    }

    private suspend fun loadBitmap(urlStr: String): Bitmap? {
        return withContext(Dispatchers.IO) {
            try {
                // Handle data: URIs
                if (urlStr.startsWith("data:")) {
                    val base64Data = urlStr.substringAfter(",")
                    val decoded = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                    Log.d(TAG, "loadBitmap: decoding data: URI, base64 len=${base64Data.length}, decoded bytes=${decoded.size}")
                    val bmp = BitmapFactory.decodeByteArray(decoded, 0, decoded.size)
                    Log.d(TAG, "loadBitmap: data: URI decode result=${if (bmp != null) "${bmp.width}x${bmp.height}" else "null (bad image data)"}")
                    return@withContext bmp
                }

                // Handle file:// and http(s):// URLs
                Log.d(TAG, "loadBitmap: opening URLConnection to ${urlStr.take(150)}")
                val url = URL(urlStr)
                val connection = url.openConnection()
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                val inputStream = connection.getInputStream()
                val bitmap = BitmapFactory.decodeStream(inputStream)
                inputStream.close()
                Log.d(TAG, "loadBitmap: URLConnection result=${if (bitmap != null) "${bitmap.width}x${bitmap.height}" else "null (decodeStream failed)"}")
                bitmap
            } catch (e: Exception) {
                // NOTE: if you see this log line
                // with an asset.localhost URL, the frontend fix in
                // android-notification.ts (fetch()+base64 for that host)
                // isn't taking effect => check it's actually reaching this
                // function as a data: URI instead
                Log.e(TAG, "loadBitmap: failed to load '${urlStr.take(150)}': ${e.javaClass.simpleName}: ${e.message}")
                null
            }
        }
    }

    private fun repeatModeToCompat(mode: String): Int = when (mode) {
        "one" -> PlaybackStateCompat.REPEAT_MODE_ONE
        "all" -> PlaybackStateCompat.REPEAT_MODE_ALL
        else -> PlaybackStateCompat.REPEAT_MODE_NONE
    }

    /**
     * inverse of the frontend's formatDuration
     * (parses "m:ss" or "h:mm:ss") back into milliseconds
     * returns null for the "--:--" unknown sentinel or anything else that doesn't parse, so callers can fall back safely
     */
    private fun parseTimeToMillis(time: String?): Long? {
        if (time.isNullOrEmpty()) return null
        val parts = time.split(":")
        return try {
            val seconds = when (parts.size) {
                2 -> parts[0].toLong() * 60 + parts[1].toLong()
                3 -> parts[0].toLong() * 3600 + parts[1].toLong() * 60 + parts[2].toLong()
                else -> return null
            }
            seconds * 1000
        } catch (e: NumberFormatException) {
            null
        }
    }

    private fun evaluateJs(script: String) {
        val wv = webViewRef ?: return
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            wv.evaluateJavascript(script, null)
        }
    }

    override fun onDestroy() {
        serviceScope.cancel()
        mediaSession?.release()
        mediaSession = null
        currentArtBitmap = null
        super.onDestroy()
    }
}
