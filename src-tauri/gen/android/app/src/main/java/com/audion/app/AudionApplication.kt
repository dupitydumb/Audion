package com.audion.app

import android.app.Application

class AudionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            System.loadLibrary("c++_shared")
        } catch (e: Exception) {
            // Handle error - this might happen if the library isn't bundled or on very old devices
        }
        try {
            // loaded here rather than left to TauriActivity/MainActivity => android
            // auto can start MediaNotificationService directly without ever
            // launching an activity, and the jni bridge needs the lib loaded
            // by the time that service's first native call happens
            System.loadLibrary("audion_lib")
        } catch (e: Exception) {
            // if this fails the app is broken regardless (audion_lib is the
            // whole rust core, not just the auto bridge) . MainActivity's own
            // startup will surface the real error, this is just a safety net
            // so android auto's first browse call doesn't crash the process
        }
    }
}
