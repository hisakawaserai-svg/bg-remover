//
//  ShareViewController.swift
//  BgRemoverShareExtension
//
//  Created by h S. on 2026/07/31.
//

import UIKit
import UniformTypeIdentifiers

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

    /// 受け取った画像の生データ。変換せずそのまま保持する。
    private var sharedImageData: Data?

    override func viewDidLoad() {
        super.viewDidLoad()

        setupUI()
        loadSharedImage()
    }


    /// 端末の言語が日本語か。
    ///
    /// Locale.current.language は iOS 16 以降。このターゲットの Deployment Target は
    /// アプリ本体に合わせて 15.1 なので、15 でも動く languageCode を使う
    /// （iOS 16 で deprecated だが動作は同じ）。
    private var isJapanese: Bool {
        if #available(iOS 16.0, *) {
            return Locale.current.language.languageCode?.identifier == "ja"
        }
        return Locale.current.languageCode == "ja"
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        // アプリ名
        titleLabel.text = isJapanese
        ? "スタンプ抜き"
        : "Sticker Cutout"

        titleLabel.font = .boldSystemFont(ofSize: 28)
        titleLabel.textAlignment = .center

        // ×ボタン
        let closeButton = UIButton(type: .close)

        closeButton.translatesAutoresizingMaskIntoConstraints = false

        closeButton.addTarget(
            self,
            action: #selector(cancelTapped),
            for: .touchUpInside
        )

        view.addSubview(closeButton)

        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 15
            ),

            closeButton.trailingAnchor.constraint(
                equalTo: view.trailingAnchor,
                constant: -20
            )
        ])
      
        // 画像
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .secondarySystemBackground
        imageView.layer.cornerRadius = 16
        imageView.clipsToBounds = true
        // 縦長の画像でも自然に見せるため、高さを固定せず余白を全部もらう。
        // 固定値だと縦長画像が枠の中で小さく縮んでしまう。
        // 優先度を下げて、タイトルとボタンを配置した残りに伸び縮みさせる。
        imageView.setContentHuggingPriority(.defaultLow, for: .vertical)
        imageView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)


        // キャンセル
        let cancelButton = UIButton(type: .system)

        cancelButton.setTitle(
            isJapanese
            ? "キャンセル"
            : "Cancel",
            for: .normal
        )

        cancelButton.addTarget(
            self,
            action: #selector(cancelTapped),
            for: .touchUpInside
        )


        // 透過する
        let removeButton = UIButton(type: .system)

        removeButton.setTitle(
            isJapanese
            ? "透過する"
            : "Remove Background",
            for: .normal
        )

        removeButton.backgroundColor = .systemBlue
        removeButton.setTitleColor(.white, for: .normal)
        removeButton.layer.cornerRadius = 14

        removeButton.addTarget(
            self,
            action: #selector(removeTapped),
            for: .touchUpInside
        )


        let buttonStack = UIStackView(
            arrangedSubviews: [
                cancelButton,
                removeButton
            ]
        )

        buttonStack.axis = .horizontal
        buttonStack.spacing = 20
        buttonStack.distribution = .fillEqually

        let stack = UIStackView(
            arrangedSubviews: [
                titleLabel,
                imageView,
                buttonStack
            ]
        )

        stack.axis = .vertical
        stack.spacing = 30
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)

        // 上下に貼り付けて、余った縦幅を imageView に吸わせる。
        // 中央寄せ（centerY）＋画像の高さ固定だと、縦長画像が小さく表示され、
        // 画面下部も余ってしまうため。
        NSLayoutConstraint.activate([
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

            // ボタンは高さを持たないと潰れるので明示する。
            buttonStack.heightAnchor.constraint(
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
    /// Extension からは UIApplication.shared を触れないので extensionContext.open を使う。
    /// 起動の成否に関わらず、最後は必ず Extension を閉じる。
    private func openHostApp() {
        guard let url = Self.hostAppURL else {
            closeExtension()
            return
        }

        extensionContext?.open(url) { [weak self] success in
            if !success {
                print("[ShareExtension] 本体アプリの起動に失敗しました:", url)
            }
            self?.closeExtension()
        }
    }


    /// Extension を正常終了して共有シートを閉じる。
    private func closeExtension() {
        extensionContext?.completeRequest(
            returningItems: nil,
            completionHandler: nil
        )
    }
}
