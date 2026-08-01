//
//  ShareViewController.swift
//  BgRemoverShareExtension
//
//  Created by h S. on 2026/07/31.
//

import UIKit
import UniformTypeIdentifiers

/// UIApplication の open(_:options:completionHandler:) を呼ぶためのプロトコル。
/// Extension では UIApplication.shared を参照できないので、レスポンダチェーンで
/// 取り出したインスタンスをこの型に見立てて呼ぶ。
@objc private protocol URLOpening {
    @objc(openURL:options:completionHandler:)
    func open(_ url: URL, options: [String: Any], completionHandler: ((Bool) -> Void)?)
}

/// 共有シートから画像を受け取り、App Group へ置いて本体アプリを起動するだけの画面。
///
/// 【責務をここまでに限定する】
/// 画像の変換（PNG/HEIC/WEBP）も背景除去も、この Extension ではやらない。
/// Extension はメモリ上限が厳しく（約120MB）、重い処理を持たせると落ちる。
/// 受け取った生データをそのまま置き、あとは本体アプリに任せる。
class ShareViewController: UIViewController {

    /// App Group の識別子。entitlements に書いてあるものと一致させること。
    private static let appGroupID = "group.com.sera.bgremover.app"

    /// App Group に置くファイル名。
    /// **拡張子は付けない。** 受け取る画像は HEIC/JPEG/PNG などまちまちで、
    /// 変換は本体アプリ側（第3段階）で決める。ここで .png などと名乗ると
    /// 中身と食い違うファイルができる。
    private static let sharedFileName = "share_input"

    /// 本体アプリを起動する URL。ホストアプリの Info.plist に
    /// CFBundleURLTypes として登録済み。
    private static let hostAppURL = URL(string: "bgremover://share")

    private let imageView = UIImageView()
    private let titleLabel = UILabel()
    private let descriptionLabel = UILabel()

    private let removeButton = UIButton(type: .system)
    private let activityIndicator = UIActivityIndicatorView(style: .medium)

    /// 受け取った画像の生データ。変換せずそのまま保持する。
    private var sharedImageData: Data?

    override func viewDidLoad() {
        super.viewDidLoad()

        setupUI()
        loadSharedImage()
    }

    ///
    /// Locale.current.language は iOS 16 以降。このターゲットの Deployment Target は
    /// アプリ本体に合わせて 15.1 なので、15 でも動く languageCode を使う
    /// （iOS 16 で deprecated だが動作は同じ）。
    private func setupUI() {
        view.backgroundColor = .systemGroupedBackground

        // ×ボタン
        let closeButton = UIButton(type: .system)

        closeButton.setImage(
            UIImage(
                systemName: "xmark.circle.fill"
            ),
            for: .normal
        )

        closeButton.tintColor = .tertiaryLabel

        closeButton.contentHorizontalAlignment = .fill
        closeButton.contentVerticalAlignment = .fill

        closeButton.addTarget(
            self,
            action: #selector(cancelTapped),
            for: .touchUpInside
        )

        closeButton.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(closeButton)

        // タイトル
        titleLabel.text = NSLocalizedString(
            "background_title",
            comment: ""
        )

        titleLabel.font = .boldSystemFont(ofSize: 22)
        titleLabel.textAlignment = .center

        // 説明文
        descriptionLabel.text = NSLocalizedString(
            "background_description",
            comment: ""
        )

        descriptionLabel.font = .systemFont(ofSize: 15)
        descriptionLabel.textColor = .secondaryLabel
        descriptionLabel.textAlignment = .center



        // 画像
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .secondarySystemBackground
        imageView.layer.cornerRadius = 20
        imageView.clipsToBounds = true



        // メインボタン
        var config = UIButton.Configuration.filled()

        config.title = NSLocalizedString(
            "remove_button",
            comment: ""
        )

        config.cornerStyle = .medium
        config.imagePadding = 8

        removeButton.configuration = config

        removeButton.addTarget(
            self,
            action: #selector(removeTapped),
            for: .touchUpInside
        )



        // キャンセル
        let cancelButton = UIButton(type: .system)

        cancelButton.setTitle(
            NSLocalizedString(
                "cancel_button",
                comment: ""
            ),
            for: .normal
        )

        cancelButton.addTarget(
            self,
            action: #selector(cancelTapped),
            for: .touchUpInside
        )

        // ボタン縦配置
        let buttonStack = UIStackView(
            arrangedSubviews: [
                removeButton,
                cancelButton
            ]
        )

        buttonStack.axis = .vertical
        buttonStack.spacing = 12



        let stack = UIStackView(
            arrangedSubviews: [
                titleLabel,
                descriptionLabel,
                imageView,
                buttonStack
            ]
        )

        stack.axis = .vertical
        stack.spacing = 20

        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)

        NSLayoutConstraint.activate([
          closeButton.topAnchor.constraint(
              equalTo: view.safeAreaLayoutGuide.topAnchor,
              constant: 15
          ),

          closeButton.trailingAnchor.constraint(
              equalTo: view.trailingAnchor,
              constant: -20
          ),

          closeButton.widthAnchor.constraint(
              equalToConstant: 44
          ),

          closeButton.heightAnchor.constraint(
              equalToConstant: 44
          ),

          stack.topAnchor.constraint(
              equalTo: closeButton.bottomAnchor,
              constant: 20
          ),

          stack.bottomAnchor.constraint(
              equalTo: view.safeAreaLayoutGuide.bottomAnchor,
              constant: -20
          ),

          stack.leadingAnchor.constraint(
              equalTo: view.leadingAnchor,
              constant: 30
          ),

          stack.trailingAnchor.constraint(
              equalTo: view.trailingAnchor,
              constant: -30
          ),


          removeButton.heightAnchor.constraint(
              equalToConstant: 50
          )
      ])
    }


    private func loadSharedImage() {

        guard let item =
                extensionContext?.inputItems.first
                as? NSExtensionItem,
              let attachment =
                item.attachments?.first
        else {
            return
        }


        if attachment.hasItemConformingToTypeIdentifier(
            UTType.image.identifier
        ) {

            attachment.loadItem(
                forTypeIdentifier: UTType.image.identifier,
                options: nil
            ) { item, error in

                guard let url = item as? URL,
                      let data = try? Data(contentsOf: url) else {
                    return
                }

                // 変換はしない。受け取ったバイト列をそのまま持っておき、
                // 「透過する」を押したときに App Group へ書き出す。
                let image = UIImage(data: data)

                DispatchQueue.main.async {
                    // 保持と表示はどちらもメインで行い、removeTapped との
                    // 読み書きスレッドを揃える。
                    self.sharedImageData = data
                    self.imageView.image = image
                }
            }
        }
    }


    @objc private func cancelTapped() {
      extensionContext?.cancelRequest(
          withError: NSError(
              domain: "BgRemover",
              code: 0,
              userInfo: [
                  NSLocalizedDescriptionKey: "User cancelled"
              ]
          )
      )
    }


    @objc private func removeTapped() {
        guard let data = sharedImageData,
              let container = FileManager.default.containerURL(
                  forSecurityApplicationGroupIdentifier: Self.appGroupID
              )
        else {
            // 画像が取れていない / App Group が効いていない。
            // 何もできないが、共有シートは閉じる（開いたままだと操作不能に見える）。
            print("[ShareExtension] データまたは App Group を取得できませんでした")
            closeExtension()
            return
        }

        let destination = container.appendingPathComponent(Self.sharedFileName)

        do {
            // .atomic は既存ファイルを上書きする。事前の removeItem は不要。
            // 「2回目の共有で copyItem が必ず失敗する」問題もこれで起きない。
            try data.write(to: destination, options: .atomic)
        } catch {
            print("[ShareExtension] 保存に失敗:", error)
            closeExtension()
            return
        }

        openHostApp()
    }


    /// 本体アプリを起動する。
    ///
    /// 起動の成否に関わらず、最後は必ず Extension を閉じる
    /// （閉じないと共有シートが残って操作不能に見える）。
    private func openHostApp() {
        guard let url = Self.hostAppURL else {
            closeExtension()
            return
        }

        // まず正規の API を試す。
        NSLog("[ShareExtension] open を試行: %@", url.absoluteString)
        extensionContext?.open(url) { [weak self] success in
            guard let self else { return }
            NSLog("[ShareExtension] extensionContext.open の結果: %@", success ? "成功" : "失敗")
            if !success {
                // Share Extension では extensionContext.open が効かないことがある。
                // 実機で起動しないことを確認済み（URLスキーム自体は
                // simctl openurl で開けるので、スキーム登録の問題ではない）。
                _ = self.openViaResponderChain(url)
            }
            self.closeExtension()
        }
    }


    /// レスポンダチェーンを辿って UIApplication を見つけ、URL を開く。
    ///
    /// Extension では UIApplication.shared を直接参照できない（コンパイルエラー）ため、
    /// チェーン上のインスタンスを取り出して openURL: を呼ぶ。
    /// extensionContext.open が動かない場合の控え。
    @discardableResult
    private func openViaResponderChain(_ url: URL) -> Bool {
        let selector = NSSelectorFromString("openURL:")
        var responder: UIResponder? = self

        while let current = responder {
            if current.responds(to: selector) && !(current is UIViewController) {
                // 旧 openURL: は最近の iOS では無反応なので、現行の3引数版を先に試す。
                // perform は2引数までなので @objc プロトコル経由で呼ぶ。
                if let opener = current as? URLOpening {
                    NSLog("[ShareExtension] 3引数版 open を呼ぶ: %@", String(describing: type(of: current)))
                    opener.open(url, options: [:]) { ok in
                        NSLog("[ShareExtension] 3引数版 open の結果: %@", ok ? "成功" : "失敗")
                    }
                    return true
                }
                NSLog("[ShareExtension] 旧 openURL: を呼ぶ: %@", String(describing: type(of: current)))
                _ = current.perform(selector, with: url)
                return true
            }
            responder = current.next
        }

        NSLog("[ShareExtension] レスポンダチェーンに UIApplication が見つかりませんでした")
        return false
    }


    /// Extension を正常終了して共有シートを閉じる。
    private func closeExtension() {
        extensionContext?.completeRequest(
            returningItems: nil,
            completionHandler: nil
        )
    }
}
