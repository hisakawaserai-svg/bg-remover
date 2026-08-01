import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "BgRemover",
      in: window,
      launchOptions: launchOptions
    )
    
    processShareInput()

    return true
  }
  
  // Share Extensionから渡された画像を確認する
  // React Nativeへ通知後に削除する
  func processShareInput(){
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.sera.bgremover.app"
    ) else {
        return
    }

    let shareURL = containerURL.appendingPathComponent("share_input")

    if FileManager.default.fileExists(atPath: shareURL.path) {
      
      print("Share input found:", shareURL)
      
      // ここでReact Nativeへ渡す準備をする
      // 次の段階で実装
      
      // 通知成功後に削除
      // try? FileManager.default.removeItem(at: shareURL)
    } else {
      print("Share input not found")
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
