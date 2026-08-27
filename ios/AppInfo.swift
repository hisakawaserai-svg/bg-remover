//
//  AppInfo.swift
//  BgRemover
//
//  Info.plist（＝Xcodeの MARKETING_VERSION）からアプリのバージョン文字列を
//  取得して JS へ渡すモジュール。package.json のバージョンとは独立して
//  Xcode 側の値に自動追従させるためのもの。
//

import Foundation
import React

@objc(AppInfo)
class AppInfo: NSObject {

  @objc
  func constantsToExport() -> [String: Any] {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    return ["version": version ?? ""]
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
