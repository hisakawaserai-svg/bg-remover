package com.seraapps.stampnuki

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * アプリ内レビュー（Google Play In-App Review）の要求を JS 側から呼べるようにする。
 *
 * 実際に表示されるか・表示頻度は Play 側のクォータが完全に制御するため、JS へは
 * 「要求フローを回した」ことだけを resolve で返す（出たか否かは取得できない）。
 *
 * 動作条件と方針:
 * - Play ストア経由で配布された端末（内部テストトラック含む）でのみダイアログが出る。
 *   Play 未導入端末やローカルの debug ビルドでは何も出ないが、それは異常ではない。
 * - レビュー要求は「おまけ」なので、どこで失敗しても reject せず静かに resolve(false)
 *   する。ここで例外を投げると保存完了直後の正常フローがエラー表示になりかねない
 *   （Play 未導入端末でのクラッシュ報告があるため全体を try/catch でガードする）。
 */
class ReviewModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ReviewManager"

  @ReactMethod
  fun requestReview(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    try {
      val manager = ReviewManagerFactory.create(reactApplicationContext)
      manager.requestReviewFlow().addOnCompleteListener { task ->
        if (!task.isSuccessful) {
          promise.resolve(false)
          return@addOnCompleteListener
        }
        try {
          manager.launchReviewFlow(activity, task.result)
              .addOnCompleteListener { promise.resolve(true) }
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }
}
