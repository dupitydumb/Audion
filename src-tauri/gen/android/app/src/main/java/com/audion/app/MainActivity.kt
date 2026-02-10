package com.audion.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    try {
      // Load the PermissionsPlugin into the PluginManager so JS can call plugin:permissions|...
      pluginManager.load(webView, "permissions", PermissionsPlugin(this), "permissions")
    } catch (e: Exception) {
      // Fallback: log but don't crash
      android.util.Log.e("MainActivity", "Failed to load PermissionsPlugin", e)
    }
  }
}
