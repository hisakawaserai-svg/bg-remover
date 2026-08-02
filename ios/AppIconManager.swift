//
//  AppIconManager.swift
//  BgRemover
//
//  Created by h S. on 2026/08/01.
//
//  ホーム画面のアプリアイコンを切り替えるネイティブモジュール。
//  iconName は Info.plist の CFBundleAlternateIcons のキー("Night" / "Sleep")。
//  nil を渡すと既定アイコン(AppIcon)に戻る。
//

import Foundation
import React
import UIKit

@objc(AppIconManager)
class AppIconManager: NSObject {

  @objc
  func changeIcon(
    _ iconName: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard UIApplication.shared.supportsAlternateIcons else {
        reject("unsupported", "この端末は代替アイコンに対応していません", nil)
        return
      }
      // 同じアイコンを再設定すると無駄なトーストが出るので何もしない。
      if UIApplication.shared.alternateIconName == iconName {
        resolve(iconName ?? "default")
        return
      }
      UIApplication.shared.setAlternateIconName(iconName) { error in
        if let error = error {
          reject("change_failed", error.localizedDescription, error)
        } else {
          resolve(iconName ?? "default")
        }
      }
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
