package com.audion.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class PermissionsPlugin(private val activity: Activity) : Plugin(activity) {
    
    companion object {
        private const val TAG = "PermissionsPlugin"
        private const val PERMISSION_REQUEST_CODE = 1001
    }

    @Command
    fun checkAudioPermission(invoke: Invoke) {
        val result = JSObject()
        
        val permission = getRequiredPermission()
        val status = when {
            ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED -> "granted"
            ActivityCompat.shouldShowRequestPermissionRationale(activity, permission) -> "prompt-with-rationale"
            else -> "prompt"
        }
        
        result.put("status", status)
        result.put("permission", permission)
        
        Log.d(TAG, "checkAudioPermission: status=$status, permission=$permission")
        invoke.resolve(result)
    }

    @Command
    fun requestAudioPermission(invoke: Invoke) {
        val permission = getRequiredPermission()
        
        Log.d(TAG, "requestAudioPermission: requesting $permission")
        
        // Check if already granted
        if (ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) {
            val result = JSObject()
            result.put("status", "granted")
            invoke.resolve(result)
            return
        }
        
        // Request permission
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(permission),
            PERMISSION_REQUEST_CODE
        )
        
        // Note: The actual result will come through onRequestPermissionsResult
        // For simplicity, we resolve immediately and let the frontend re-check
        val result = JSObject()
        result.put("status", "requesting")
        invoke.resolve(result)
    }

    @Command
    fun openAppSettings(invoke: Invoke) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", activity.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            
            val result = JSObject()
            result.put("success", true)
            invoke.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open app settings", e)
            invoke.reject("Failed to open app settings: ${e.message}")
        }
    }

    private fun getRequiredPermission(): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
    }

    @Command
    fun checkStoragePermission(invoke: Invoke) {
        val result = JSObject()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // For Android 11+, check if we can write to Downloads directory
                // We don't need MANAGE_EXTERNAL_STORAGE for the Downloads directory
                val downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                val canWrite = downloadsDir?.canWrite() ?: false
                result.put("granted", canWrite)
                result.put("type", "downloads_access")
                Log.d(TAG, "checkStoragePermission: downloads directory writable=$canWrite")
            } else {
                val permission = Manifest.permission.WRITE_EXTERNAL_STORAGE
                val granted = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
                result.put("granted", granted)
                result.put("permission", permission)
                Log.d(TAG, "checkStoragePermission: write_external_storage=$granted")
            }
            invoke.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "checkStoragePermission failed", e)
            invoke.reject("check_storage_permission_failed")
        }
    }

    @Command
    fun requestStoragePermission(invoke: Invoke) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // For Android 11+, we don't need to request special permission for Downloads
                // The directory should be accessible via scoped storage
                val downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                val canWrite = downloadsDir?.canWrite() ?: false
                val result = JSObject()
                result.put("granted", canWrite)
                result.put("status", "checked")
                invoke.resolve(result)
                Log.d(TAG, "requestStoragePermission: downloads directory writable=$canWrite")
            } else {
                val permission = Manifest.permission.WRITE_EXTERNAL_STORAGE
                if (ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) {
                    val result = JSObject()
                    result.put("granted", true)
                    invoke.resolve(result)
                    return
                }

                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(permission),
                    PERMISSION_REQUEST_CODE
                )

                val result = JSObject()
                result.put("status", "requesting")
                invoke.resolve(result)
                Log.d(TAG, "requestStoragePermission: requesting WRITE_EXTERNAL_STORAGE")
            }
        } catch (e: Exception) {
            Log.e(TAG, "requestStoragePermission failed", e)
            invoke.reject("request_storage_permission_failed: ${e.message}")
        }
    }
}
