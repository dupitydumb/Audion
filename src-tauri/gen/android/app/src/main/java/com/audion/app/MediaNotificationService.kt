package com.audion.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL
import kotlinx.coroutines.*

/**
 * Foreground service for persistent media notification with playback controls.
 * Shows track title, artist, album art, and play/pause/next/prev buttons,
 * similar to Spotify's media notification.
 */
class MediaNotificationService : Service() {

    companion object {
        const val CHANNEL_ID = "audion_media_channel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_PLAY_PAUSE = "com.audion.app.PLAY_PAUSE"
        const val ACTION_NEXT = "com.audion.app.NEXT"
        const val ACTION_PREVIOUS = "com.audion.app.PREVIOUS"
        const val ACTION_STOP = "com.audion.app.STOP"

        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val EXTRA_ART_URL = "art_url"

        // Reference to the WebView for evaluating JS commands
        var webViewRef: WebView? = null
    }

    private var mediaSession: MediaSessionCompat? = null
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var currentArtBitmap: Bitmap? = null
    private var currentArtUrl: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        setupMediaSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> {
                evaluateJs("window.__audionMediaAction?.('playPause')")
            }
            ACTION_NEXT -> {
                evaluateJs("window.__audionMediaAction?.('next')")
            }
            ACTION_PREVIOUS -> {
                evaluateJs("window.__audionMediaAction?.('previous')")
            }
            ACTION_STOP -> {
                evaluateJs("window.__audionMediaAction?.('stop')")
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                // Update notification with metadata from intent
                val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Unknown Title"
                val artist = intent?.getStringExtra(EXTRA_ARTIST) ?: "Unknown Artist"
                val album = intent?.getStringExtra(EXTRA_ALBUM) ?: ""
                val isPlaying = intent?.getBooleanExtra(EXTRA_IS_PLAYING, false) ?: false
                val artUrl = intent?.getStringExtra(EXTRA_ART_URL)

                updateNotification(title, artist, album, isPlaying, artUrl)
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
                }
                override fun onPause() {
                    evaluateJs("window.__audionMediaAction?.('playPause')")
                }
                override fun onSkipToNext() {
                    evaluateJs("window.__audionMediaAction?.('next')")
                }
                override fun onSkipToPrevious() {
                    evaluateJs("window.__audionMediaAction?.('previous')")
                }
                override fun onStop() {
                    evaluateJs("window.__audionMediaAction?.('stop')")
                    stopSelf()
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
        artUrl: String?
    ) {
        // Update media session metadata
        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)

        currentArtBitmap?.let {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
        }

        mediaSession?.setMetadata(metadataBuilder.build())

        // Update playback state
        val stateBuilder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_STOP
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1f
            )

        mediaSession?.setPlaybackState(stateBuilder.build())

        // Load album art asynchronously if URL changed
        if (artUrl != null && artUrl != currentArtUrl && artUrl.isNotEmpty()) {
            currentArtUrl = artUrl
            serviceScope.launch {
                try {
                    val bitmap = loadBitmap(artUrl)
                    if (bitmap != null) {
                        currentArtBitmap = bitmap
                        // Re-update with the loaded bitmap
                        withContext(Dispatchers.Main) {
                            updateNotification(title, artist, album, isPlaying, null)
                        }
                    }
                } catch (e: Exception) {
                    // Ignore art loading failures
                }
            }
        }

        // Build notification
        val notification = buildNotification(title, artist, album, isPlaying)
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(
        title: String,
        artist: String,
        album: String,
        isPlaying: Boolean
    ): Notification {
        // Intent to open the app when notification is tapped
        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        // Action intents
        val prevIntent = PendingIntent.getService(
            this, 0,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_PREVIOUS },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPauseIntent = PendingIntent.getService(
            this, 1,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_PLAY_PAUSE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nextIntent = PendingIntent.getService(
            this, 2,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this, 3,
            Intent(this, MediaNotificationService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setDeleteIntent(stopIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(R.drawable.ic_skip_previous, "Previous", prevIntent)
            .addAction(
                if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play,
                if (isPlaying) "Pause" else "Play",
                playPauseIntent
            )
            .addAction(R.drawable.ic_skip_next, "Next", nextIntent)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2) // prev, play/pause, next
                    .setShowCancelButton(true)
                    .setCancelButtonIntent(stopIntent)
            )

        currentArtBitmap?.let {
            builder.setLargeIcon(it)
        }

        return builder.build()
    }

    private suspend fun loadBitmap(urlStr: String): Bitmap? {
        return withContext(Dispatchers.IO) {
            try {
                // Handle data: URIs
                if (urlStr.startsWith("data:")) {
                    val base64Data = urlStr.substringAfter(",")
                    val decoded = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                    return@withContext BitmapFactory.decodeByteArray(decoded, 0, decoded.size)
                }

                // Handle file:// and http(s):// URLs
                val url = URL(urlStr)
                val connection = url.openConnection()
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                val inputStream = connection.getInputStream()
                val bitmap = BitmapFactory.decodeStream(inputStream)
                inputStream.close()
                bitmap
            } catch (e: Exception) {
                null
            }
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
