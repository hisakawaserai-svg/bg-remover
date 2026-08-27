//
//  ReviewManager.swift
//  BgRemover
//
//  アプリ内レビュー（App Store）の要求をネイティブに委ねるモジュール。
//  SKStoreReviewController.requestReview は OS 標準 API で、追加の pod や
//  App Store Connect 側の設定は不要。表示可否・頻度（365日で最大3回）は
//  OS が完全に管理するため、JS へは「要求した」ことだけを resolve で返す
//  （実際に出たかは取得できない）。
//
//  呼び出しタイミングの判定（累計書き出し回数が閾値に達したか等）は JS 側
//  （src/review）で行い、ここは「今この瞬間に要求する」責務だけを持つ。
//

import Foundation
import React
import StoreKit
import UIKit

@objc(ReviewManager)
class ReviewManager: NSObject {

  @objc
  func requestReview(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if #available(iOS 14.0, *),
        let scene = UIApplication.shared.connectedScenes
          .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
      {
        SKStoreReviewController.requestReview(in: scene)
      } else {
        // フォアグラウンドの windowScene が取れない場合の保険。
        SKStoreReviewController.requestReview()
      }
      resolve(true)
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
