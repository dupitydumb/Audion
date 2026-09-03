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
import java.io.File

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var activeCopyThread: Thread? = null

  // see initAudioContext in src-tauri/src/lib.rs
  // non static native method
  // JNI passes 'this' (the activity) as the implicit second parameter automatically
  private external fun initAudioContext()

  companion object {
    const val REQUEST_FOLDER_PICKER = 1001
    const val REQUEST_SAVE_FILE = 1002
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // one time handoff of the JavaVM/Activity to rust's ndk_context
    // so cpal's AAudio backend can open a stream
    // safe to call multiple times 
    // initAudioContext guards against re initializing on the rust side
    initAudioContext()

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

  override fun onDestroy() {
    // app is closing => stop any in-flight file copy
    activeCopyThread?.interrupt()
    activeCopyThread = null
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    MediaNotificationService.webViewRef = webView
    webView.addJavascriptInterface(AudioInterface(this), "AndroidMediaNotification")
    webView.addJavascriptInterface(FolderPickerInterface(this), "AndroidFolderPicker")
    webView.addJavascriptInterface(FileSaverInterface(this), "AndroidFileSaver")
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

  /**
   * launch the system Save As dialog (SAF)
   * resulting URI is returned back via js: window.__onAndroidFileSaved(uri)
   */
  fun launchSaveFilePicker(name: String, mimeType: String) {
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = mimeType
      putExtra(Intent.EXTRA_TITLE, name)
    }
    startActivityForResult(intent, REQUEST_SAVE_FILE)
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

        // Request MANAGE_EXTERNAL_STORAGE on Android 11+ if picking from external/removable media
        if (Build.VERSION.SDK_INT >= 30 && !android.os.Environment.isExternalStorageManager()) {
          val isExternal = realPath != null && !realPath.startsWith("/storage/emulated/") && !realPath.startsWith("/sdcard")
          if (isExternal) {
            try {
              val intent = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                setData(Uri.parse("package:${packageName}"))
              }
              startActivity(intent)

              android.widget.Toast.makeText(
                this,
                "Please grant All Files Access to read music from external USB/SD card",
                android.widget.Toast.LENGTH_LONG
              ).show()

              wv.post {
                wv.evaluateJavascript("window.__onAndroidFolderPicked(null)", null)
              }
              return
            } catch (e: Exception) {
              e.printStackTrace()
            }
          }
        }

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

    if (requestCode == REQUEST_SAVE_FILE) {
      val wv = webViewRef ?: return
      if (resultCode == Activity.RESULT_OK && data != null) {
        val uri: Uri = data.data ?: return

        // persist permission so the app can write to this file again later if needed
        val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
          contentResolver.takePersistableUriPermission(uri, takeFlags)
        } catch (e: SecurityException) {
          // some providers don't support persistable permissions
          // the URI is still valid for this immediate write
        }

        val uriStr = uri.toString().replace("'", "\\'")
        wv.post {
          wv.evaluateJavascript("window.__onAndroidFileSaved('$uriStr')", null)
        }
      } else {
        // user cancelled
        wv.post {
          wv.evaluateJavascript("window.__onAndroidFileSaved(null)", null)
        }
      }
    }
  }

  /**
   * Resolve a content:// tree URI to a real /storage/... path.
   * Works for primary and SD card/USB volumes on Android 5+.
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
        val volumeId = parts[0]
        val subPath = parts[1]

        val storageManager = getSystemService(Context.STORAGE_SERVICE) as android.os.storage.StorageManager
        var volumePath: String? = null
        for (volume in storageManager.storageVolumes) {
          val uuid = volume.uuid
          if (uuid != null && uuid.equals(volumeId, ignoreCase = true)) {
            if (Build.VERSION.SDK_INT >= 30) {
              volumePath = volume.directory?.absolutePath
            } else {
              try {
                val getPathMethod = volume.javaClass.getMethod("getPath")
                volumePath = getPathMethod.invoke(volume) as? String
              } catch (e: Exception) {
                e.printStackTrace()
              }
            }
            break
          }
        }

        val baseDir = volumePath ?: "/storage/$volumeId"
        if (subPath.isEmpty()) baseDir
        else "$baseDir/$subPath"
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

  inner class FileSaverInterface(private val context: Context) {
    /**
     * 1: show the system Save As picker
     * result comes back via window.__onAndroidFileSaved(uriOrNull)
     */
    @JavascriptInterface
    fun saveFile(name: String, mimeType: String) {
      runOnUiThread {
        launchSaveFilePicker(name, mimeType)
      }
    }

    /**
     * 3: copy a temp file (real filesystem path) into the picked content:// URI
     * result comes back via window.__onAndroidFileCopied(true/false) => unless the
     * activity is being destroyed mid-copy, in which case we abandon silently
     * (no point calling back into a webview that's gone)
     */
    @JavascriptInterface
    fun copyTempToUri(tempPath: String, uriString: String) {
      val srcFile = File(tempPath)
      val destUri = Uri.parse(uriString)

      val thread = Thread {
        var success = false
        var interrupted = false
        try {
          context.contentResolver.openOutputStream(destUri)?.use { out ->
            srcFile.inputStream().use { input ->
              val buffer = ByteArray(8 * 1024)
              while (true) {
                if (Thread.currentThread().isInterrupted) {
                  interrupted = true
                  break
                }
                val read = input.read(buffer)
                if (read == -1) break
                out.write(buffer, 0, read)
              }
            }
          }
          success = !interrupted
        } catch (e: Exception) {
          e.printStackTrace()
          success = false
        } finally {
          activeCopyThread = null
        }

        if (interrupted) {
          // app is going away => clean up rather than leaving a truncated file
          // and an orphaned temp file behind
          try {
            context.contentResolver.delete(destUri, null, null)
          } catch (e: Exception) {
            e.printStackTrace()
          }
          try {
            srcFile.delete()
          } catch (e: Exception) {
            e.printStackTrace()
          }
        } else {
          // copy finished. regardless of success or failure we have to clean up temp files
          try {
            srcFile.delete()
          } catch (e: Exception) {
            e.printStackTrace()
          }
          webViewRef?.post {
            webViewRef?.evaluateJavascript("window.__onAndroidFileCopied($success)", null)
          }
        }
      }
      activeCopyThread = thread
      thread.start()
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
      duration: String?,
      isShuffled: Boolean,
      repeatMode: String?
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
          putExtra(MediaNotificationService.EXTRA_IS_SHUFFLED, isShuffled)
          putExtra(MediaNotificationService.EXTRA_REPEAT_MODE, repeatMode)
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
      duration: String?,
      isShuffled: Boolean,
      repeatMode: String?
    ) {
      startNotification(title, artist, album, isPlaying, isLoved, artUrl, currentTime, duration, isShuffled, repeatMode)
    }

    @JavascriptInterface
    fun stopNotification() {
        val intent = Intent(context, MediaNotificationService::class.java)
        context.stopService(intent)
    }
  }
}
