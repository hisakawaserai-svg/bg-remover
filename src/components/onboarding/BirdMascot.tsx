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
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

/** 翼の回転軸(肩の位置)。100×100 基準。 */
const WING_ORIGIN = { x: 64, y: 46 };

interface Props {
  variant: 'day' | 'night' | 'sleep';
  /** 描画ボックスの一辺(px)。内部は 100×100 基準を size に拡縮 */
  size?: number;
  /**
   * 翼の角度(ラジアン)。渡すと羽ばたく。省略時は従来どおり静止。
   * SplashAnimationView から Reanimated の SharedValue を渡して使う。
   */
  wingAngle?: SharedValue<number>;
  /**
   * 背景の丸・太陽・月・星・Zzz を描くか。既定 true(＝従来どおり)。
   * false にするとキャラ単体になる。スプラッシュのように背景を呼び出し側が
   * 持つ場合、シーン円が色の付いた円盤として残ってしまうため。
   */
  showScene?: boolean;
  /**
   * 目を閉じるか。既定は variant==='sleep' のとき閉じる(＝従来どおり)。
   * 配色(variant)を変えずに「起きる」だけを表現したい時に明示指定する。
   */
  eyesClosed?: boolean;
}

export default function BirdMascot({
  variant,
  size = 120,
  wingAngle,
  showScene = true,
  eyesClosed,
}: Props) {
  const k = size / 100; // 100基準 → 実サイズ
  const isDay = variant === 'day';
  const isNight = variant === 'night';
  const isSleep = variant === 'sleep';
  const closed = eyesClosed ?? isSleep;
  // wingAngle 未指定なら常に 0＝無回転。Hook は条件分岐せず常に呼ぶ。
  const wingTransform = useDerivedValue(
    () => [{ rotate: wingAngle?.value ?? 0 }],
    [wingAngle],
  );

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: k }]}>
        {/* ─ 背景の丸(シーン) ─ */}
        {showScene && (
          <Circle
            cx={50}
            cy={50}
            r={48}
            color={
              isDay
                ? '#BFE6FF'
                : isNight
                ? '#1E2A55'
                : '#B8B5E8'
            }
          />
        )}

        {!showScene ? null : isDay ? (
          <Circle cx={78} cy={24} r={11} color="#FFD23F" />
        ) : isNight ? (
          <>
            <Circle cx={76} cy={24} r={11} color="#F3ECC4" />
            <Circle cx={71} cy={21} r={10} color="#1E2A55" />
            <Circle cx={26} cy={22} r={2} color="#FFFFFF" />
            <Circle cx={40} cy={14} r={1.5} color="#FFFFFF" />
            <Circle cx={22} cy={40} r={1.5} color="#FFFFFF" />
          </>
        ) : (
          <>
            {/* 眠り背景 */}
            <Circle cx={75} cy={25} r={13} color="#FFF1A8" />

            {/* Zzz */}
            <Path
              path="M25 25 L33 25 L25 35 L33 35"
              color="#FFFFFF"
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
              strokeJoin="round"
            />
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
        {/* 翼: 体の右側にうっすら黒。肩(WING_ORIGIN)を軸に回せるよう Group で包む */}
        <Group transform={wingTransform} origin={WING_ORIGIN}>
          <Oval x={61} y={44} width={18} height={32} color="#D8D8DC" />
        </Group>
        {/* 黒目2点 */}
        {closed ? (
          <>
            {/* 閉じた目 */}
            <Path
              path="M39 48 Q42 51 45 48"
              color="#1C1C1E"
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
            />
            <Path
              path="M55 48 Q58 51 61 48"
              color="#1C1C1E"
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
            />
          </>
        ) : (
          <>
            <Circle cx={42} cy={48} r={3} color="#1C1C1E" />
            <Circle cx={58} cy={48} r={3} color="#1C1C1E" />
          </>
        )}
        {/* 三角くちばし(オレンジ) */}
        <Path
          path={
            closed
              ? "M47 55 L53 55 L50 58 Z"
              : "M47 54 L53 54 L50 60 Z"
          }
          color="#FF9500"
        />
        {/* ほっぺ(うっすらピンク) */}
        <Circle cx={36} cy={56} r={3.5} color="rgba(255,150,170,0.45)" />
        <Circle cx={64} cy={56} r={3.5} color="rgba(255,150,170,0.45)" />
      </Group>
    </Canvas>
  );
}
