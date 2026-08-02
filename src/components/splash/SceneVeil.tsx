/**
 * SceneVeil.tsx — スプラッシュ層(＝これが削れると下のホーム画面が見える)
 *
 * 下のホーム画面を隠しているのがこの層で、reveal フェーズで
 * パターンごとの出方(RevealSpec)に従って**完全に**消える。
 *
 *   linear … 帯状の境目が from → to へ流れる（端から剥がれる）
 *   radial … ある一点から円状に広がる（羽ばたきの風・着地の衝撃・衝突）
 *   fade   … 全体が一様に薄れる（眠気が晴れる）
 *
 * 約束事:
 *   progress=0 で**全面シーン色**、progress=1 で**全面クリア(＝ホーム画面が全部見える)**。
 *   色を残す(residue)ことはしない。ホーム画面へそのまま繋ぐのが目的なので
 *   途中で止めない。
 *
 * 注意(過去のバグ):
 *   Skia のグラデーションは始点〜終点の外側を「端の色」で塗る。斜めの軸だと
 *   画面の隅が軸の外に出るため、progress=0 でも隅が透明色で塗られてしまう。
 *   そのため軸を画面の四隅が必ず内側に入る長さへ**延長**してから使う。
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Rect,
  LinearGradient,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { RevealSpec, SplashLayout } from './types';
import { clamp01, mix } from './ease';

/** 境目に乗せる光。透明化が「走っている」ことを見せるための派手さ。 */
const EDGE_GLOW = 'rgba(255,255,255,0.92)';
/** 波紋リングの色。明るい背景でも暗い背景でも見えるように白。 */
const RING_COLOR = 'rgba(255,255,255,0.85)';
/** 波紋リングの本数と、後続リングの遅れ(進捗比)。 */
const RING_COUNT = 3;
const RING_DELAY = 0.16;

interface Props {
  spec: RevealSpec;
  /** 0 = 全面シーン色 / 1 = 全部消えてホーム画面が見える。 */
  progress: SharedValue<number>;
  /** シーン色の不透明版と透明版。 */
  colors: { solid: string; clear: string };
  layout: SplashLayout;
}

export default function SceneVeil({ spec, progress, colors, layout }: Props) {
  const { width, height } = layout;

  const band = spec.kind === 'fade' ? 0 : spec.band;
  const radial = spec.kind === 'radial';

  // 境目(0..1)。linear は 1+band → -band、radial は -band → 1+band と逆向きに走る。
  // どちらも 0 で全面シーン色、1 で完全に消える。
  const positions = useDerivedValue(() => {
    const edge = radial
      ? mix(progress.value, -band, 1 + band)
      : mix(progress.value, 1 + band, -band);
    const a = clamp01(edge);
    const b = clamp01(edge + band);
    // 境目のすぐ内側に細い光の筋を入れる。
    const glow = clamp01(a + (b - a) * 0.18);
    return radial ? [0, a, glow, b, 1] : [0, a, glow, b, 1];
  }, [band, radial]);

  // 一様フェード用。
  const veilOpacity = useDerivedValue(() => 1 - progress.value, []);

  // linear の軸。画面の四隅が必ず軸の内側に入るよう延長する(上のコメント参照)。
  const line = useMemo(() => {
    if (spec.kind !== 'linear') {
      return { start: vec(0, 0), end: vec(width, height) };
    }
    const f = spec.from(layout);
    const t = spec.to(layout);
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // 四隅を軸へ射影し、はみ出す量ぶんだけ両端を伸ばす。
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ];
    let min = Infinity;
    let max = -Infinity;
    for (const [cx, cy] of corners) {
      const proj = (cx - f.x) * ux + (cy - f.y) * uy;
      min = Math.min(min, proj);
      max = Math.max(max, proj);
    }
    return {
      start: vec(f.x + ux * min, f.y + uy * min),
      end: vec(f.x + ux * max, f.y + uy * max),
    };
  }, [spec, layout, width, height]);

  // radial の中心と、画面全体を覆いきる半径。
  const ripple = useMemo(() => {
    if (spec.kind !== 'radial') {
      return { center: vec(width / 2, height / 2), radius: 1 };
    }
    const c = spec.center(layout);
    return { center: vec(c.x, c.y), radius: spec.radius(layout) };
  }, [spec, layout, width, height]);

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Group opacity={spec.kind === 'fade' ? veilOpacity : 1}>
        <Rect x={0} y={0} width={width} height={height}>
          {spec.kind === 'linear' ? (
            <LinearGradient
              start={line.start}
              end={line.end}
              // 境目より手前は不透明、奥は透明。間に細い光の筋を挟む。
              colors={[
                colors.solid,
                colors.solid,
                EDGE_GLOW,
                colors.clear,
                colors.clear,
              ]}
              positions={positions}
            />
          ) : spec.kind === 'radial' ? (
            <RadialGradient
              c={ripple.center}
              r={ripple.radius}
              // 内側から透明になっていく＝波紋が広がる。
              colors={[
                colors.clear,
                colors.clear,
                EDGE_GLOW,
                colors.solid,
                colors.solid,
              ]}
              positions={positions}
            />
          ) : (
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, height)}
              colors={[colors.solid, colors.solid]}
              positions={[0, 1]}
            />
          )}
        </Rect>
      </Group>

      {/* 波紋リング(radial のみ)。膜の上に重ねて衝撃を強調する。 */}
      {radial && <RippleRings progress={progress} ripple={ripple} />}
    </Canvas>
  );
}

/** 広がって消えるリングを数本重ねる。 */
function RippleRings({
  progress,
  ripple,
}: {
  progress: SharedValue<number>;
  ripple: { center: ReturnType<typeof vec>; radius: number };
}) {
  return (
    <>
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <RippleRing key={i} index={i} progress={progress} ripple={ripple} />
      ))}
    </>
  );
}

function RippleRing({
  index,
  progress,
  ripple,
}: {
  index: number;
  progress: SharedValue<number>;
  ripple: { center: ReturnType<typeof vec>; radius: number };
}) {
  // 後続のリングほど遅れて出る。進捗に対して少し先行させ、境目の外側を走らせる。
  const r = useDerivedValue(() => {
    const p = clamp01(progress.value * 1.15 - index * RING_DELAY);
    return p * ripple.radius;
  }, [index, ripple]);

  const opacity = useDerivedValue(() => {
    const p = clamp01(progress.value * 1.15 - index * RING_DELAY);
    // 出てすぐ濃く、広がるにつれ薄れる。
    return p <= 0 ? 0 : Math.max(0, 1 - p) * 0.9;
  }, [index]);

  const strokeWidth = useDerivedValue(() => {
    const p = clamp01(progress.value * 1.15 - index * RING_DELAY);
    return mix(p, 6, 1.5);
  }, [index]);

  return (
    <Circle
      c={ripple.center}
      r={r}
      color={RING_COLOR}
      opacity={opacity}
      style="stroke"
      strokeWidth={strokeWidth}
    />
  );
}
