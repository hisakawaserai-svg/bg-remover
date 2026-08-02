/**
 * TouchLoupe — 指で隠れている編集位置を拡大表示するルーペ。
 *
 * 【なぜ隅固定なのか】
 * 指の近くに追従させる方式（iOS のテキスト選択風）は、ルーペ自身が編集対象を
 * 隠してしまう。テキスト選択で成立するのは対象が1行だからで、絵の編集では
 * 隠れる面積がそのまま邪魔になる。加えて指と一緒に動くので視線が落ち着かない。
 * 隅に固定し、指がその隅に近づいた時だけ反対側へ逃がす方式にしてある。
 *
 * 【なぜ軽いのか】
 * 画素をコピーして拡大画像を作るのではなく、親が既に持っている SkImage を
 * 別の変換でもう一度描くだけ。テクスチャは共有されるのでメモリはほぼ増えず、
 * 描画コストもルーペの矩形ぶんしかない。
 *
 * 3つのツール（復元ブラシ・スポイト・ポリゴン編集）で共用する。
 * 位置は「画像座標」で受け取るので、呼ぶ側のズームやパンの状態に依存しない。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  ImageShader,
  Line,
  Rect,
  Circle,
  vec,
  FilterMode,
  MipmapMode,
} from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';

/** ルーペの1辺(px)。大きくすると見やすいが画面を食う。 */
export const LOUPE_SIZE = 116;
/** 画像の1pxをルーペ内で何倍にするか。 */
export const LOUPE_MAGNIFY = 3.5;
/** 指がこの距離(表示px)までルーペに近づいたら反対側へ逃がす。 */
const AVOID_MARGIN = 24;

interface Props {
  /** 拡大して見せる画像。親が描画に使っているものをそのまま渡す。 */
  image: SkImage | null;
  /** 画像1pxあたりの表示px（親の ds）。ルーペ内の倍率は ds × magnify になる。 */
  ds: number;
  /** 注目点（画像座標）。null ならルーペを出さない。 */
  point: { x: number; y: number } | null;
  /** 指の表示座標。ルーペを避けさせるためだけに使う。 */
  touch: { x: number; y: number } | null;
  /** キャンバスの表示サイズ。左右どちらへ置くかの判定に使う。 */
  canvasW: number;
  /** 市松模様。渡すと透過部分が分かりやすくなる。 */
  checkerImage?: SkImage | null;
  checkerTile?: number;
  /**
   * レティクル中心に重ねる円の半径（画像px）。復元ブラシの太さを示す。
   * 省略すると十字だけになる。
   */
  brushRadius?: number;
  magnify?: number;
}

export default function TouchLoupe({
  image,
  ds,
  point,
  touch,
  canvasW,
  checkerImage,
  checkerTile = 8,
  brushRadius,
  magnify = LOUPE_MAGNIFY,
}: Props) {
  if (!image || !point) return null;

  // 既定は左上。指が左上に来たら右上へ逃がす。
  // 上下ではなく左右だけで逃がすのは、下側にツール説明やブラシ設定があり、
  // 下へ動かすとそちらと重なるため。
  const nearLeft = touch != null
    && touch.x < LOUPE_SIZE + AVOID_MARGIN
    && touch.y < LOUPE_SIZE + AVOID_MARGIN;
  const left = nearLeft ? canvasW - LOUPE_SIZE - 8 : 8;

  // 注目点がルーペの中心に来るような平行移動。
  // 画像座標 p は (p * ds * magnify) の位置に描かれるので、
  // それが中心 (LOUPE_SIZE/2) に一致するようずらす。
  const scale = ds * magnify;
  const tx = LOUPE_SIZE / 2 - point.x * scale;
  const ty = LOUPE_SIZE / 2 - point.y * scale;

  const half = LOUPE_SIZE / 2;
  const reticle = brushRadius != null
    ? Math.max(2, brushRadius * scale)
    : null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { left, width: LOUPE_SIZE, height: LOUPE_SIZE }]}>
      <Canvas style={styles.canvas}>
        {/* 透過部分が分かるよう市松を敷く */}
        {checkerImage ? (
          <Rect x={0} y={0} width={LOUPE_SIZE} height={LOUPE_SIZE}>
            <ImageShader
              image={checkerImage}
              tx="repeat"
              ty="repeat"
              fit="none"
              transform={[{ scale: checkerTile }]}
              sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
            />
          </Rect>
        ) : (
          <Rect x={0} y={0} width={LOUPE_SIZE} height={LOUPE_SIZE} color="#3A3A3C" />
        )}

        <Group transform={[{ translateX: tx }, { translateY: ty }, { scale: magnify }]}>
          {/* 画素の境目をぼかさない。1px単位の作業をするための拡大なので、
              補間すると何を触っているのか分からなくなる。 */}
          <SkiaImage
            image={image}
            x={0} y={0}
            width={image.width() * ds}
            height={image.height() * ds}
            fit="fill"
            sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
          />
        </Group>

        {/* レティクル。中心が実際の編集位置。 */}
        {reticle != null && (
          <Circle cx={half} cy={half} r={reticle} color="rgba(52,199,89,0.30)" />
        )}
        <Line p1={vec(half - 10, half)} p2={vec(half - 3, half)} color="#FFF" strokeWidth={1} />
        <Line p1={vec(half + 3, half)} p2={vec(half + 10, half)} color="#FFF" strokeWidth={1} />
        <Line p1={vec(half, half - 10)} p2={vec(half, half - 3)} color="#FFF" strokeWidth={1} />
        <Line p1={vec(half, half + 3)} p2={vec(half, half + 10)} color="#FFF" strokeWidth={1} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 8,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: '#000',
  },
  canvas: { flex: 1 },
});
