package com.bgremover.app

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.io.OutputStream
import java.util.LinkedList
import kotlin.math.abs
import kotlin.math.min

class BgRemoverModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BgRemover"

    // ── MLKit 被写体検出モード ────────────────────────────────────────────────

    @ReactMethod
    fun removeAndSave(imageUri: String, promise: Promise) {
        try {
            val original = loadBitmap(imageUri)
                ?: run { promise.reject("DECODE_ERROR", "画像のデコードに失敗しました"); return }

            val options = SubjectSegmenterOptions.Builder()
                .enableForegroundConfidenceMask()
                .build()
            val segmenter = SubjectSegmentation.getClient(options)

            segmenter.process(InputImage.fromBitmap(original, 0))
                .addOnFailureListener { e ->
                    promise.reject("SEG_ERROR", "セグメンテーション失敗: ${e.message}")
                }
                .addOnSuccessListener { result ->
                    try {
                        val maskBuffer = result.getForegroundConfidenceMask()
                            ?: run {
                                promise.reject("MASK_ERROR", "マスクが取得できませんでした")
                                return@addOnSuccessListener
                            }

                        val imgW = original.width
                        val imgH = original.height
                        val pixelCount = imgW * imgH

                        // マスクを一括展開
                        val maskArray = FloatArray(pixelCount)
                        maskBuffer.rewind()
                        maskBuffer.get(maskArray)

                        // 元画像ピクセルを一括取得してマスクのアルファを適用
                        val pixels = IntArray(pixelCount)
                        original.getPixels(pixels, 0, imgW, 0, 0, imgW, imgH)
                        for (i in pixels.indices) {
                            val alpha = (maskArray[i] * 255).toInt().coerceIn(0, 255)
                            val src = pixels[i]
                            pixels[i] = Color.argb(alpha, Color.red(src), Color.green(src), Color.blue(src))
                        }

                        val output = Bitmap.createBitmap(imgW, imgH, Bitmap.Config.ARGB_8888)
                        output.setHasAlpha(true)
                        output.setPixels(pixels, 0, imgW, 0, 0, imgW, imgH)

                        val savedUri = saveToGallery(cropAndResize(output, TARGET_SIZE))
                        promise.resolve(savedUri)
                    } catch (e: Exception) {
                        Log.e("BgRemover", "MLKit処理例外: ${e.message}", e)
                        promise.reject("INNER_ERROR", "${e.javaClass.simpleName}: ${e.message}")
                    }
                }
        } catch (e: Exception) {
            promise.reject("BG_REMOVER_ERROR", e.message ?: "不明なエラー")
        }
    }

    // ── 色ベース背景除去モード（フラッドフィル） ──────────────────────────────

    /**
     * 四隅の色を背景色と判定し、フラッドフィルで背景領域を透明にする。
     * tolerance: 色の一致判定の許容値（RGB各チャンネル、デフォルト30）
     */
    @ReactMethod
    fun removeByColor(imageUri: String, tolerance: Int, promise: Promise) {
        try {
            val original = loadBitmap(imageUri)
                ?: run { promise.reject("DECODE_ERROR", "画像のデコードに失敗しました"); return }

            val imgW = original.width
            val imgH = original.height
            val pixelCount = imgW * imgH
            val tol = tolerance.coerceIn(0, 255)

            // ピクセルを一括取得
            val pixels = IntArray(pixelCount)
            original.getPixels(pixels, 0, imgW, 0, 0, imgW, imgH)

            // 四隅のピクセル色を背景色の候補として取得
            val corners = intArrayOf(
                pixels[0],                          // 左上
                pixels[imgW - 1],                    // 右上
                pixels[(imgH - 1) * imgW],           // 左下
                pixels[(imgH - 1) * imgW + imgW - 1] // 右下
            )

            Log.d("BgRemover", "背景色候補: " + corners.map {
                "RGB(${Color.red(it)},${Color.green(it)},${Color.blue(it)})"
            })

            // フラッドフィル済みフラグ
            val visited = BooleanArray(pixelCount)

            // 四隅それぞれを起点にフラッドフィル
            val seeds = intArrayOf(
                0,                                   // 左上
                imgW - 1,                             // 右上
                (imgH - 1) * imgW,                    // 左下
                (imgH - 1) * imgW + imgW - 1          // 右下
            )

            for (seedIdx in seeds.indices) {
                val bgColor = corners[seedIdx]
                floodFill(pixels, visited, imgW, imgH, seeds[seedIdx] % imgW, seeds[seedIdx] / imgW, bgColor, tol)
            }

            // visited=true のピクセルを透明にする
            for (i in pixels.indices) {
                if (visited[i]) {
                    pixels[i] = Color.TRANSPARENT
                }
            }

            Log.d("BgRemover", "フラッドフィル完了: 透明化=${visited.count { it }}px / ${pixelCount}px")

            val output = Bitmap.createBitmap(imgW, imgH, Bitmap.Config.ARGB_8888)
            output.setHasAlpha(true)
            output.setPixels(pixels, 0, imgW, 0, 0, imgW, imgH)

            val savedUri = saveToGallery(cropAndResize(output, TARGET_SIZE))
            promise.resolve(savedUri)
        } catch (e: Exception) {
            Log.e("BgRemover", "色ベース除去例外: ${e.message}", e)
            promise.reject("COLOR_REMOVE_ERROR", e.message ?: "不明なエラー")
        }
    }

    /**
     * (startX, startY) を起点にフラッドフィル。
     * bgColor と tolerance 以内の色差を持つ隣接ピクセルを visited=true にする。
     * スタックベース BFS（再帰だとスタックオーバーフローするため）。
     */
    private fun floodFill(
        pixels: IntArray, visited: BooleanArray,
        w: Int, h: Int,
        startX: Int, startY: Int,
        bgColor: Int, tolerance: Int
    ) {
        val queue = LinkedList<Int>()
        val startIdx = startY * w + startX
        if (visited[startIdx]) return
        queue.add(startIdx)
        visited[startIdx] = true

        val bgR = Color.red(bgColor)
        val bgG = Color.green(bgColor)
        val bgB = Color.blue(bgColor)

        while (queue.isNotEmpty()) {
            val idx = queue.poll()
            val x = idx % w
            val y = idx / w

            // 上下左右の4方向を探索
            val neighbors = intArrayOf(
                if (x > 0) idx - 1 else -1,         // 左
                if (x < w - 1) idx + 1 else -1,     // 右
                if (y > 0) idx - w else -1,          // 上
                if (y < h - 1) idx + w else -1       // 下
            )

            for (ni in neighbors) {
                if (ni < 0 || visited[ni]) continue
                val px = pixels[ni]
                // RGB 各チャンネルの差が tolerance 以内なら同じ背景とみなす
                if (abs(Color.red(px) - bgR) <= tolerance &&
                    abs(Color.green(px) - bgG) <= tolerance &&
                    abs(Color.blue(px) - bgB) <= tolerance
                ) {
                    visited[ni] = true
                    queue.add(ni)
                }
            }
        }
    }

    // ── 共通ユーティリティ ────────────────────────────────────────────────────

    private fun loadBitmap(imageUri: String): Bitmap? {
        val uri = Uri.parse(imageUri)
        val inputStream = reactContext.contentResolver.openInputStream(uri) ?: return null
        val bmp = BitmapFactory.decodeStream(inputStream)?.copy(Bitmap.Config.ARGB_8888, true)
        inputStream.close()
        return bmp
    }

    private fun cropAndResize(bitmap: Bitmap, size: Int): Bitmap {
        val side = min(bitmap.width, bitmap.height)
        val left = (bitmap.width - side) / 2
        val top = (bitmap.height - side) / 2
        val cropped = Bitmap.createBitmap(bitmap, left, top, side, side).also { it.setHasAlpha(true) }
        return Bitmap.createScaledBitmap(cropped, size, size, true).also { it.setHasAlpha(true) }
    }

    private fun saveToGallery(bitmap: Bitmap): String {
        val filename = "icon_${System.currentTimeMillis()}.png"
        val resolver = reactContext.contentResolver

        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, filename)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/アイコン抜き")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }

        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }

        val imageUri = resolver.insert(collection, values)
            ?: throw Exception("MediaStore への挿入に失敗しました")

        val outputStream: OutputStream = resolver.openOutputStream(imageUri)
            ?: throw Exception("出力ストリームを開けませんでした")

        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        outputStream.close()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val updateValues = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
            resolver.update(imageUri, updateValues, null, null)
        }

        return imageUri.toString()
    }

    companion object {
        private const val TARGET_SIZE = 500
    }
}
