//
//  ShareViewController.swift
//  BgRemoverShareExtension
//
//  Created by h S. on 2026/07/31.
//

import UIKit
import UniformTypeIdentifiers
import Social

class ShareViewController: SLComposeServiceViewController {


    override func isContentValid() -> Bool {
        // Do validation of contentText and/or NSExtensionContext attachments here
        return true
    }

    override func didSelectPost() {
        // This is called after the user selects Post. Do the upload of contentText and/or NSExtensionContext attachments.
    
        // Inform the host that we're done, so it un-blocks its UI. Note: Alternatively you could call super's -didSelectPost, which will similarly complete the extension context.
        self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
    }

    override func configurationItems() -> [Any]! {
        // To add configuration options via table cells at the bottom of the sheet, return an array of SLComposeSheetConfigurationItem here.
        return []
    }
  
    // 受け取れるか確認
  override func viewDidLoad() {
      super.viewDidLoad()

      guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
            let attachments = extensionItem.attachments else {
          return
      }

      let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: "group.com.sera.bgremover.app"
      )

      print("App Group:", containerURL?.absoluteString ?? "nil")

      for attachment in attachments {
          print("Attachment type:", attachment.registeredTypeIdentifiers)

          if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {

              attachment.loadItem(
                  forTypeIdentifier: UTType.image.identifier,
                  options: nil
              ) { item, error in

                if let url = item as? URL {
                  
                  let destination = containerURL!
                    .appendingPathComponent("share_input.png")
                  
                  do {
                    // removeItem も throw するので do の中に入れる。
                    // 外に置くと loadItem のクロージャが非throwのためコンパイルが通らない。
                    if FileManager.default.fileExists(atPath: destination.path) {
                      try FileManager.default.removeItem(at: destination)
                    }

                    guard let image = UIImage(contentsOfFile: url.path) else {
                      print("Image load failed")
                      return
                    }
                    
                    guard let pngData = image.pngData() else {
                      print("PNG conversion failed")
                      return
                    }
                    
                    try pngData.write(to: destination)
                    
                    print("Saved PNG:", destination)
                    
                  } catch {
                    print("Save error:", error)
                  }
                }

                  if let error = error {
                      print("Error:", error)
                  }
              }
          }
      }
  }
}
