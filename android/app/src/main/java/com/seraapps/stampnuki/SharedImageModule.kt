package com.bgremover.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream

/**
 * 他アプリからの画像共有（ACTION_SEND, image系MIME、1枚のみ）を JS 側へ橋渡しする。
 *
 * - 未起動時: 起動時の Intent を getSharedImageUri() で読み取る（JS 側が起動直後に呼ぶ）。
 * - 起動中（singleTask）: MainActivity#onNewIntent → ActivityEventListener#onNewIntent 経由で
 *   本モジュールに届くので、JS へイベントを送って気付かせる。実際のデータ取得は
 *   引き続き getSharedImageUri() を呼んでもらう（Uri の受け渡しは Promise 経由に統一）。
 *
 * content:// の中身はそのままでは既存の convertToPng（file:// 前提）が読めないため、
 * ここでキャッシュへコピーして file:// にしてから返す。読み取った Intent の
 * EXTRA_STREAM は消しておき、二重取得（前面復帰の AppState イベントと重複した場合など）を防ぐ。
 */
class SharedImageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "SharedImageModule"

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {}

  override fun onNewIntent(intent: Intent) {
    if (!isSharedImageIntent(intent)) return
    reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, null)
  }

  private fun isSharedImageIntent(intent: Intent): Boolean =
      intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true

  @ReactMethod
  fun getSharedImageUri(promise: Promise) {
    try {
      val intent = reactApplicationContext.currentActivity?.intent
      if (intent == null || !isSharedImageIntent(intent)) {
        promise.resolve(null)
        return
      }

      val sourceUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_STREAM)
      }

      // 取得済みとして扱い、以後の呼び出しでは同じ画像を再処理しない。
      intent.removeExtra(Intent.EXTRA_STREAM)
      intent.action = null

      if (sourceUri == null) {
        promise.resolve(null)
        return
      }

      val destFile = File(reactApplicationContext.cacheDir, "shared_${System.currentTimeMillis()}")
      val opened = reactApplicationContext.contentResolver.openInputStream(sourceUri)?.use { input ->
        FileOutputStream(destFile).use { output -> input.copyTo(output) }
        true
      } ?: false

      if (!opened) {
        promise.resolve(null)
        return
      }

      promise.resolve("file://${destFile.absolutePath}")
    } catch (e: Exception) {
      promise.reject("SHARED_IMAGE_ERROR", e)
    }
  }

  companion object {
    const val EVENT_NAME = "onSharedImageReceived"
  }
}
