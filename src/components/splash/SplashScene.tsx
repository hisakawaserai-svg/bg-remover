/**
 * SplashScene.tsx — 背景の世界の中身(太陽・雲・月・星)
 *
 * BirdMascot が variant ごとに描いているシーン要素を、画面いっぱいの世界として
 * 置き直したもの。色と形はマスコットと同じものを使い、世界観を揃えている。
 * ただし sleep の Zzz だけは置かない(画面全体だとうるさいので雲にしてある)。
 *
 * ポイントは「透明化の波が通り過ぎた要素から消える」こと。
 * 一律にフェードさせるとただの重ね消しに見えるので、各要素の位置を reveal の
 * 進行方向へ射影して**消える順番**を作っている。progress=1 では必ず全要素が
 * 消え、背景は完全なチェッカーになる。
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Path,
} from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { BirdVariant, RevealSpec, SplashLayout } from './types';
import { clamp01 } from './ease';

/** 要素が消えるのにかける時間(進捗比)。短いほど波にパッと消される。 */
const VANISH_SPAN = 0.3;
/** 消える順番の効き具合。1 に近いほど波の通過順がはっきり出る。 */
const ORDER_STRENGTH = 0.7;

type Shape =
  | { kind: 'circle'; x: number; y: number; r: number; color: string }
  | { kind: 'path'; x: number; y: number; path: string; color: string }
  | {
      kind: 'stroke';
      x: number;
      y: number;
      path: string;
      color: string;
      width: number;
    };

/**
 * 三日月のパス(中心 0,0 / 半径 r)。
 *
 * 上端(0,-r)と下端(0,r)を結ぶ2本の弧で作る。外側は半径 r の円弧、内側は
 * それより大きい半径の円弧を逆向きに戻すことで、内側が抉れて三日月になる。
 * 内側の半径が外側以下だと形が破綻するので BULGE は必ず 1 より大きくする。
 */
const BULGE = 1.45;
function crescent(r: number): string {
  const inner = r * BULGE;
  return (
    `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r}` +
    ` A ${inner} ${inner} 0 0 0 0 ${-r} Z`
  );
}

/** 4方向にとがった星のパス。 */
function sparkle(r: number): string {
  const w = r * 0.26;
  return (
    `M 0 ${-r} L ${w} ${-w} L ${r} 0 L ${w} ${w}` +
    ` L 0 ${r} L ${-w} ${w} L ${-r} 0 L ${-w} ${-w} Z`
  );
}

/**
 * 雲(円を3つ並べて下を平らに切った形)。アイコンの雲と同じ作り。
 * 半透明を重ねると円の継ぎ目が出るので、呼び出し側は不透明色を渡すこと。
 */
function cloud(r: number): string {
  const w = r * 1.35;
  return (
    `M ${-w} ${r * 0.55}` +
    ` A ${r * 0.72} ${r * 0.72} 0 0 1 ${-w} ${-r * 0.1}` +
    ` A ${r} ${r} 0 0 1 ${r * 0.1} ${-r * 0.5}` +
    ` A ${r * 0.78} ${r * 0.78} 0 0 1 ${w} ${r * 0.55} Z`
  );
}

function shapesFor(variant: BirdVariant, l: SplashLayout): Shape[] {
  const { width: w, height: h } = l;
  const unit = Math.min(w, h);

  if (variant === 'day') {
    const r = unit * 0.1;
    const cx = w * 0.78;
    const cy = h * 0.16;
    return [
      // 太陽の光(薄い輪)→ 本体の順に描く。
      { kind: 'circle', x: cx, y: cy, r: r * 1.7, color: 'rgba(255,210,63,0.22)' },
      { kind: 'circle', x: cx, y: cy, r, color: '#FFD23F' },
      { kind: 'circle', x: w * 0.16, y: h * 0.1, r: unit * 0.035, color: 'rgba(255,255,255,0.55)' },
      { kind: 'circle', x: w * 0.24, y: h * 0.12, r: unit * 0.05, color: 'rgba(255,255,255,0.55)' },
    ];
  }

  if (variant === 'night') {
    const r = unit * 0.1;
    return [
      { kind: 'path', x: w * 0.78, y: h * 0.15, path: crescent(r), color: '#F3ECC4' },
      { kind: 'path', x: w * 0.2, y: h * 0.12, path: sparkle(unit * 0.045), color: '#FFFFFF' },
      { kind: 'path', x: w * 0.12, y: h * 0.3, path: sparkle(unit * 0.03), color: '#FFF6C8' },
      { kind: 'path', x: w * 0.42, y: h * 0.07, path: sparkle(unit * 0.025), color: '#FFFFFF' },
      { kind: 'path', x: w * 0.88, y: h * 0.42, path: sparkle(unit * 0.032), color: '#FFFFFF' },
      { kind: 'circle', x: w * 0.3, y: h * 0.22, r: unit * 0.01, color: '#FFFFFF' },
      { kind: 'circle', x: w * 0.62, y: h * 0.1, r: unit * 0.008, color: '#FFFFFF' },
      { kind: 'circle', x: w * 0.08, y: h * 0.5, r: unit * 0.01, color: '#FFFFFF' },
      { kind: 'circle', x: w * 0.92, y: h * 0.66, r: unit * 0.009, color: '#FFFFFF' },
    ];
  }

  // sleep: 月と雲。静かな夜空にしたいので Zzz は置かず、雲を漂わせる。
  const r = unit * 0.105;
  const cloudColor = '#E2E0F4'; // 藤色の背景に白を混ぜた不透明色
  return [
    { kind: 'path', x: w * 0.78, y: h * 0.15, path: crescent(r), color: '#FFF1A8' },
    { kind: 'path', x: w * 0.2, y: h * 0.24, path: cloud(unit * 0.09), color: cloudColor },
    { kind: 'path', x: w * 0.62, y: h * 0.35, path: cloud(unit * 0.06), color: cloudColor },
    { kind: 'path', x: w * 0.32, y: h * 0.76, path: cloud(unit * 0.075), color: cloudColor },
  ];
}

/** その要素が「波に飲まれる」順番(0=最初 / 1=最後)。 */
function orderOf(spec: RevealSpec, l: SplashLayout, x: number, y: number) {
  if (spec.kind === 'radial') {
    const c = spec.center(l);
    return clamp01(Math.hypot(x - c.x, y - c.y) / spec.radius(l));
  }
  if (spec.kind === 'linear') {
    const f = spec.from(l);
    const t = spec.to(l);
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const len2 = dx * dx + dy * dy || 1;
    return clamp01(((x - f.x) * dx + (y - f.y) * dy) / len2);
  }
  // fade は一律。
  return 0;
}

interface Props {
  variant: BirdVariant;
  spec: RevealSpec;
  /** 透明化の進捗(0→1)。SceneVeil と同じ値。 */
  progress: SharedValue<number>;
  layout: SplashLayout;
}

export default function SplashScene({ variant, spec, progress, layout }: Props) {
  const shapes = useMemo(() => {
    return shapesFor(variant, layout).map(s => ({
      shape: s,
      order: orderOf(spec, layout, s.x, s.y),
    }));
  }, [variant, spec, layout]);

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {shapes.map((s, i) => (
        <SceneShape key={i} shape={s.shape} order={s.order} progress={progress} />
      ))}
    </Canvas>
  );
}

function SceneShape({
  shape,
  order,
  progress,
}: {
  shape: Shape;
  order: number;
  progress: SharedValue<number>;
}) {
  // 波が自分の位置を通り過ぎたら消える。progress=1 では必ず 0 になるよう、
  // 残り時間で割って正規化する。
  const opacity = useDerivedValue(() => {
    const start = order * ORDER_STRENGTH;
    const span = Math.max(VANISH_SPAN, 1 - start);
    return 1 - clamp01((progress.value - start) / span);
  }, [order]);

  if (shape.kind === 'circle') {
    return (
      <Circle
        cx={shape.x}
        cy={shape.y}
        r={shape.r}
        color={shape.color}
        opacity={opacity}
      />
    );
  }

  if (shape.kind === 'stroke') {
    return (
      <Group transform={[{ translateX: shape.x }, { translateY: shape.y }]}>
        <Path
          path={shape.path}
          color={shape.color}
          opacity={opacity}
          style="stroke"
          strokeWidth={shape.width}
          strokeCap="round"
          strokeJoin="round"
        />
      </Group>
    );
  }

  return (
    <Group transform={[{ translateX: shape.x }, { translateY: shape.y }]}>
      <Path path={shape.path} color={shape.color} opacity={opacity} />
    </Group>
  );
}
