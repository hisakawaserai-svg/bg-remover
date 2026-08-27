package com.seraapps.stampnuki

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/**
 * build.gradle の versionName（＝BuildConfig.VERSION_NAME）を JS へ渡すモジュール。
 * package.json のバージョンとは独立して Android 側の値に自動追従させるためのもの。
 */
class AppInfoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AppInfo"

  override fun getConstants(): Map<String, Any> = mapOf("version" to BuildConfig.VERSION_NAME)
}
