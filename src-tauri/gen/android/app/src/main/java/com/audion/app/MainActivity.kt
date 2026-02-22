package com.audion.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Request permissions for music scanning
    if (Build.VERSION.SDK_INT >= 33) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.READ_MEDIA_AUDIO), 1)
      }
      // Also notification permission
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
      }
    } else {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE), 1)
      }
    }

    // Register back button handler
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webViewRef
        if (wv != null) {
          // Ask the SPA if it can handle navigation
          wv.evaluateJavascript("(function() { return window.__audionHandleBack ? window.__audionHandleBack() : false; })()") { result ->
            if (result == "false" || result == "null" || result == null) {
              // At root view — minimize app instead of closing
              moveTaskToBack(true)
            }
            // else: SPA handled the back navigation
          }
        } else {
          // No WebView reference — fallback to minimize
          moveTaskToBack(true)
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    MediaNotificationService.webViewRef = webView
    webView.addJavascriptInterface(AudioInterface(this), "AndroidMediaNotification")
  }

  inner class AudioInterface(private val context: Context) {
    @JavascriptInterface
    fun startNotification(title: String, artist: String, album: String, isPlaying: Boolean, artUrl: String?) {
        try {
            val intent = Intent(context, MediaNotificationService::class.java).apply {
                putExtra(MediaNotificationService.EXTRA_TITLE, title)
                putExtra(MediaNotificationService.EXTRA_ARTIST, artist)
                putExtra(MediaNotificationService.EXTRA_ALBUM, album)
                putExtra(MediaNotificationService.EXTRA_IS_PLAYING, isPlaying)
                putExtra(MediaNotificationService.EXTRA_ART_URL, artUrl)
            }
            ContextCompat.startForegroundService(context, intent)
        } catch (e: Exception) {
            // Android 12+ throws ForegroundServiceStartNotAllowedException if app is in background
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun updateNotification(title: String, artist: String, album: String, isPlaying: Boolean, artUrl: String?) {
         startNotification(title, artist, album, isPlaying, artUrl)
    }

    @JavascriptInterface
    fun stopNotification() {
        val intent = Intent(context, MediaNotificationService::class.java)
        context.stopService(intent)
    }
  }
}
