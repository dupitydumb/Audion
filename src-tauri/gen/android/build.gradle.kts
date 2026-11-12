buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

subprojects {
    plugins.withId("com.android.base") {
        extensions.configure<com.android.build.api.variant.AndroidComponentsExtension<*, *, *>>("androidComponents") {
            beforeVariants { variantBuilder ->
                (variantBuilder as? com.android.build.api.variant.HasAndroidTestBuilder)?.enableAndroidTest = false
            }
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

