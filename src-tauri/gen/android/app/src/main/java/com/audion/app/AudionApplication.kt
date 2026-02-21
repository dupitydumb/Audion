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
    }
}
