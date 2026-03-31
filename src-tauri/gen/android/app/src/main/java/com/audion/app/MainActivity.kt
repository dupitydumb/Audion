package com.audion.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.Manifest
import android.content.pm.PackageManager
import android.content.Context
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null

  companion object {
    const val REQUEST_FOLDER_PICKER = 1001
  }

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
    webView.addJavascriptInterface(FolderPickerInterface(this), "AndroidFolderPicker")
  }

  /**
   * Launch the system folder picker (Storage Access Framework).
   * The result is returned back via JS: window.__onAndroidFolderPicked(path)
   */
  fun launchFolderPicker() {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    }
    startActivityForResult(intent, REQUEST_FOLDER_PICKER)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)

    if (requestCode == REQUEST_FOLDER_PICKER) {
      val wv = webViewRef ?: return
      if (resultCode == Activity.RESULT_OK && data != null) {
        val uri: Uri = data.data ?: return

        // Persist permission so the app can access this folder later
        val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        contentResolver.takePersistableUriPermission(uri, takeFlags)

        // Convert the URI to a real filesystem path
        val realPath = resolveUriToPath(uri)
        val jsPath = realPath?.replace("'", "\\'") ?: ""

        if (jsPath.isNotEmpty()) {
          wv.post {
            wv.evaluateJavascript("window.__onAndroidFolderPicked('$jsPath')", null)
          }
        } else {
          // Fallback: pass the URI string so the app can still use it
          val uriStr = uri.toString().replace("'", "\\'")
          wv.post {
            wv.evaluateJavascript("window.__onAndroidFolderPicked('$uriStr')", null)
          }
        }
      } else {
        // User cancelled
        webViewRef?.post {
          wv.evaluateJavascript("window.__onAndroidFolderPicked(null)", null)
        }
      }
    }
  }

  /**
   * Resolve a content:// tree URI to a real /storage/... path.
   * Works for primary and SD card volumes on Android 5+.
   */
  private fun resolveUriToPath(uri: Uri): String? {
    val docId = androidx.documentfile.provider.DocumentFile.fromTreeUri(this, uri)?.uri
      ?.lastPathSegment ?: return null

    return when {
      // Primary storage: "primary:Music" → /storage/emulated/0/Music
      docId.startsWith("primary:") -> {
        val subPath = docId.removePrefix("primary:")
        if (subPath.isEmpty()) "/storage/emulated/0"
        else "/storage/emulated/0/$subPath"
      }
      // SD card or other volume: "XXXX-XXXX:Music" → /storage/XXXX-XXXX/Music
      docId.contains(":") -> {
        val parts = docId.split(":", limit = 2)
        val volume = parts[0]
        val subPath = parts[1]
        if (subPath.isEmpty()) "/storage/$volume"
        else "/storage/$volume/$subPath"
      }
      else -> null
    }
  }

  inner class FolderPickerInterface(private val context: Context) {
    @JavascriptInterface
    fun pickFolder() {
      runOnUiThread {
        launchFolderPicker()
      }
    }
  }

  inner class AudioInterface(private val context: Context) {

    @JavascriptInterface
    fun startNotification(
      title: String,
      artist: String,
      album: String,
      isPlaying: Boolean,
      isLoved: Boolean,
      artUrl: String?,
      currentTime: String?,
      duration: String?
    ) {
      try {
        val intent = Intent(context, MediaNotificationService::class.java).apply {
          putExtra(MediaNotificationService.EXTRA_TITLE, title)
          putExtra(MediaNotificationService.EXTRA_ARTIST, artist)
          putExtra(MediaNotificationService.EXTRA_ALBUM, album)
          putExtra(MediaNotificationService.EXTRA_IS_PLAYING, isPlaying)
          putExtra(MediaNotificationService.EXTRA_IS_LOVED, isLoved)
          putExtra(MediaNotificationService.EXTRA_ART_URL, artUrl)
          putExtra(MediaNotificationService.EXTRA_CURRENT_TIME, currentTime)
          putExtra(MediaNotificationService.EXTRA_DURATION, duration)
        }
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        // Android 12+ throws ForegroundServiceStartNotAllowedException if app is in background
        e.printStackTrace()
      }
    }

    @JavascriptInterface
    fun updateNotification(
      title: String,
      artist: String,
      album: String,
      isPlaying: Boolean,
      isLoved: Boolean,
      artUrl: String?,
      currentTime: String?,
      duration: String?
    ) {
      startNotification(title, artist, album, isPlaying, isLoved, artUrl, currentTime, duration)
    }

    @JavascriptInterface
    fun stopNotification() {
        val intent = Intent(context, MediaNotificationService::class.java)
        context.stopService(intent)
    }
  }
}
