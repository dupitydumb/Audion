import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.audionplayer.audion"

    signingConfigs {
        create("release") {
            val keystorePropertiesFile = sequenceOf("key.properties", "keystore.properties")
                .map { rootProject.file(it) }
                .firstOrNull { it.exists() }
            val keystoreProperties = Properties()
            if (keystorePropertiesFile != null && keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
                keyAlias = keystoreProperties["keyAlias"] as? String ?: (keystoreProperties.getProperty("keyAlias") ?: "")
                keyPassword = (keystoreProperties["password"] ?: keystoreProperties["keyPassword"] ?: keystoreProperties.getProperty("keyPassword")) as? String ?: ""
                val storePath = (keystoreProperties["storeFile"] ?: keystoreProperties.getProperty("storeFile")) as? String
                if (!storePath.isNullOrBlank()) {
                    val rootKeystore = rootProject.file(storePath)
                    val appKeystore = file(storePath)
                    storeFile = if (rootKeystore.exists()) rootKeystore else if (appKeystore.exists()) appKeystore else rootKeystore
                }
                storePassword = (keystoreProperties["password"] ?: keystoreProperties["storePassword"] ?: keystoreProperties.getProperty("storePassword")) as? String ?: ""
            }
        }
    }

    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.audionplayer.audion"
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }

    packagingOptions {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    sourceSets {
        getByName("main") {
            jni.srcDirs(emptyList<File>())
            jniLibs.srcDirs("src/jniLibs")
        }
    }
}

androidComponents {
    beforeVariants { variantBuilder ->
        variantBuilder.enableAndroidTest = false
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.media:media:1.7.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

val copyLibCppShared by tasks.registering {
    description = "Copies libc++_shared.so from the Android NDK into jniLibs for every built ABI."
    doLast {
        val abiToTriple = mapOf(
            "arm64-v8a" to "aarch64-linux-android",
            "armeabi-v7a" to "arm-linux-androideabi",
            "x86" to "i686-linux-android",
            "x86_64" to "x86_64-linux-android"
        )
        val jniLibsDir = file("src/main/jniLibs")
        val activeAbis = abiToTriple.filterKeys { abi ->
            File(jniLibsDir, "$abi/libaudion_lib.so").exists()
        }
        if (activeAbis.isEmpty()) return@doLast

        val sdkRoot = sequenceOf(
            System.getenv("ANDROID_HOME"),
            System.getenv("ANDROID_SDK_ROOT")
        ).firstOrNull { !it.isNullOrBlank() }

        val ndkDir = sequenceOf(
            System.getenv("NDK_HOME"),
            System.getenv("ANDROID_NDK_HOME")
        )
            .filterNotNull()
            .filter { it.isNotBlank() }
            .map { file(it) }
            .firstOrNull { it.isDirectory }
            ?: sdkRoot?.let { File(it, "ndk") }
                ?.takeIf { it.isDirectory }
                ?.listFiles()
                ?.filter { it.isDirectory }
                ?.maxByOrNull { it.name }

        if (ndkDir == null || !ndkDir.isDirectory) {
            throw GradleException("Android NDK not found; set NDK_HOME or ANDROID_HOME to bundle libc++_shared.so.")
        }

        val prebuiltDir = File(ndkDir, "toolchains/llvm/prebuilt")
        val hostDirs = prebuiltDir.listFiles()?.filter { it.isDirectory } ?: emptyList()

        activeAbis.forEach { (abi, triple) ->
            val targetDir = File(jniLibsDir, abi)
            val destFile = File(targetDir, "libc++_shared.so")
            val sourceFile = hostDirs
                .map { File(it, "sysroot/usr/lib/$triple/libc++_shared.so") }
                .firstOrNull { it.isFile }
                ?: ndkDir.walkTopDown().firstOrNull {
                    it.isFile && it.name == "libc++_shared.so" && it.parentFile?.name == triple
                }

            if (sourceFile == null) {
                throw GradleException("libc++_shared.so not found in NDK ($ndkDir) for $abi ($triple).")
            }
            if (!destFile.exists() || destFile.length() != sourceFile.length()) {
                sourceFile.copyTo(destFile, overwrite = true)
                logger.lifecycle("Copied libc++_shared.so for $abi from ${sourceFile.absolutePath}")
            }
        }
    }
}

afterEvaluate {
    tasks.matching {
        it.name.startsWith("merge") && it.name.endsWith("JniLibFolders")
    }.configureEach {
        dependsOn(copyLibCppShared)
        mustRunAfter(tasks.matching { t -> t.name.startsWith("rustBuild") })
    }
    copyLibCppShared.configure {
        mustRunAfter(tasks.matching { t -> t.name.startsWith("rustBuild") })
    }
}

apply(from = "tauri.build.gradle.kts")