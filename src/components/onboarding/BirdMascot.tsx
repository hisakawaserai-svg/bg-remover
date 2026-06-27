/**
 * BirdMascot.tsx — オンボーディング共通マスコット(シマエナガ)
 *
 * 図形のみで描くため theme 非依存・色はハードコード。
 * 全ステップで使い回す前提で1ファイルに集約しておく(後でまとめて調整できる)。
 *
 * 描画は @shopify/react-native-skia(既存 PolygonTutorial と同じ)。
 * react-native-svg は本プロジェクト未導入のため Skia で代替。
 *
 *   variant='day'   : 背景に水色丸＋太陽
 *   variant='night' : 背景に紺色丸＋月＋星
 *   キャラ本体(白い体・黒目・くちばし・翼/尾)は共通。
 */
import React from 'react';
import {
  Canvas,
  Group,
  Circle,
  Oval,
  Path,
} from '@shopify/react-native-skia';

interface Props {
  variant: 'day' | 'night';
  /** 描画ボックスの一辺(px)。内部は 100×100 基準を size に拡縮 */
  size?: number;
}

export default function BirdMascot({ variant, size = 120 }: Props) {
  const k = size / 100; // 100基準 → 実サイズ
  const isDay = variant === 'day';

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: k }]}>
        {/* ─ 背景の丸(シーン) ─ */}
        <Circle cx={50} cy={50} r={48} color={isDay ? '#BFE6FF' : '#1E2A55'} />

        {isDay ? (
          /* 太陽: 右上に黄色丸 */
          <Circle cx={78} cy={24} r={11} color="#FFD23F" />
        ) : (
          <>
            {/* 月: クリーム丸＋紺の丸を重ねて三日月に */}
            <Circle cx={76} cy={24} r={11} color="#F3ECC4" />
            <Circle cx={71} cy={21} r={10} color="#1E2A55" />
            {/* 星 */}
            <Circle cx={26} cy={22} r={2}   color="#FFFFFF" />
            <Circle cx={40} cy={14} r={1.5} color="#FFFFFF" />
            <Circle cx={22} cy={40} r={1.5} color="#FFFFFF" />
          </>
        )}

        {/* ─ キャラ本体(共通) ─ */}
        {/* 尾: 体の右下から斜め後方へ長く伸びる(シマエナガの長い尾) */}
        <Path path="M55 72 L84 86 L82 93 L52 81 Z" color="#3A3A3C" />
        {/* 足: 体の下にちょこんと2本(左右対称・オレンジ) */}
        <Path
          path="M45 82 L45 90 M42 91 L45 90 L48 91"
          color="#FF9500"
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
        />
        <Path
          path="M55 82 L55 90 M52 91 L55 90 L58 91"
          color="#FF9500"
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
        />
        {/* ふわふわの白い体(＝頭一体型の丸) */}
        <Oval x={21} y={23} width={58} height={62} color="#FFFFFF" />
        {/* 翼: 体の右側にうっすら黒 */}
        <Oval x={61} y={44} width={18} height={32} color="#D8D8DC" />
        {/* 黒目2点 */}
        <Circle cx={42} cy={48} r={3} color="#1C1C1E" />
        <Circle cx={58} cy={48} r={3} color="#1C1C1E" />
        {/* 三角くちばし(オレンジ) */}
        <Path path="M47 54 L53 54 L50 60 Z" color="#FF9500" />
        {/* ほっぺ(うっすらピンク) */}
        <Circle cx={36} cy={56} r={3.5} color="rgba(255,150,170,0.45)" />
        <Circle cx={64} cy={56} r={3.5} color="rgba(255,150,170,0.45)" />
      </Group>
    </Canvas>
  );
}
