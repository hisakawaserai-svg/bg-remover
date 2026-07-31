//
//  ShareViewController.swift
//  BgRemoverShareExtension
//
//  Created by h S. on 2026/07/31.
//

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    private let imageView = UIImageView()
    private let titleLabel = UILabel()

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

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(
                equalTo: view.centerXAnchor
            ),
            stack.centerYAnchor.constraint(
                equalTo: view.centerYAnchor
            ),

            stack.leadingAnchor.constraint(
                equalTo: view.leadingAnchor,
                constant: 30
            ),

            stack.trailingAnchor.constraint(
                equalTo: view.trailingAnchor,
                constant: -30
            ),

            imageView.heightAnchor.constraint(
                equalToConstant: 250
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

                guard let url = item as? URL else {
                    return
                }


                if let data = try? Data(contentsOf: url),
                   let image = UIImage(data: data) {

                    DispatchQueue.main.async {
                        self.imageView.image = image
                    }
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

        print("透過開始")

        // ここに後で
        // App Group保存
        // 本体アプリ起動
    }
}
