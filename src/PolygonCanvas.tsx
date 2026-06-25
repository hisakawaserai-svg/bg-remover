// 多角形描画キャンバス。
// - Skia Canvas で画像・ポリゴン・頂点を描画。
// - PanResponder 1つでタップ(頂点追加/ポリゴン選択)・ドラッグ(頂点移動/パン)・ピンチ(ズーム)を処理。
// - 座標は常に画像ピクセル空間で保持。表示スケール・ズームは描画時に適用。
import React, { useRef, useState, useMemo } from 'react';
import { PanResponder, StyleSheet, View, Text } from 'react-native';
import {
  Canvas,
  Image as SkiaImage,
  Path,
  Circle,
  Group,
  Skia,
} from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';

export type Polygon = { id: number; points: [number, number][] };

interface Props {
  image: SkImage;
  imageW: number;
  imageH: number;
  displayW: number;
  polygons: Polygon[];
  drawing: [number, number][]; // 現在描画中(未確定)の頂点列
  selectedId: number | null;
  onDrawingChange: (pts: [number, number][]) => void;
  onPolygonCommit: (poly: Polygon) => void; // 多角形確定
  onPolygonSelect: (id: number | null) => void;
  onVertexMove: (polyId: number, vIdx: number, x: number, y: number) => void;
}

const POLY_COLORS = [
  { fill: 'rgba(244,67,54,0.25)',  border: '#F44336' },
  { fill: 'rgba(33,150,243,0.25)', border: '#2196F3' },
  { fill: 'rgba(76,175,80,0.25)',  border: '#4CAF50' },
  { fill: 'rgba(255,152,0,0.25)',  border: '#FF9800' },
  { fill: 'rgba(156,39,176,0.25)', border: '#9C27B0' },
  { fill: 'rgba(0,188,212,0.25)',  border: '#00BCD4' },
  { fill: 'rgba(233,30,99,0.25)',  border: '#E91E63' },
  { fill: 'rgba(121,85,72,0.25)',  border: '#795548' },
];

// 最初の頂点をこの距離(表示px)以内でタップすると多角形を閉じる。
const CLOSE_DIST_PX = 22;
// 頂点ドラッグのヒット判定半径(表示px)。
const VERTEX_HIT_PX = 20;
// この移動量(表示px)を超えたらパンとみなす(タップとの区別)。
const PAN_THRESHOLD = 10;
// ズーム範囲。
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

type GestureMode = 'idle' | 'pending' | 'pan' | 'pinch' | 'drag_vertex';

interface ZoomState { scale: number; tx: number; ty: number }

// ─────────────────────────────────────────────────────────────────────────────

function touchDist(
  t1: { pageX: number; pageY: number },
  t2: { pageX: number; pageY: number },
): number {
  const dx = t1.pageX - t2.pageX;
  const dy = t1.pageY - t2.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function centroid(points: [number, number][]): [number, number] {
  const n = points.length;
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / n, sy / n];
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PolygonCanvas({
  image, imageW, imageH, displayW,
  polygons, drawing, selectedId,
  onDrawingChange, onPolygonCommit, onPolygonSelect, onVertexMove,
}: Props) {
  const ds = displayW / imageW; // display scale (image px → display px)
  const displayH = imageH * ds;

  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, tx: 0, ty: 0 });

  // PanResponder コールバックは初回レンダーで生成されるため、最新値は ref 経由で読む。
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const imageWRef = useRef(imageW);
  imageWRef.current = imageW;
  const imageHRef = useRef(imageH);
  imageHRef.current = imageH;
  // コールバック ref
  const onDrawingChangeRef = useRef(onDrawingChange);
  onDrawingChangeRef.current = onDrawingChange;
  const onPolygonCommitRef = useRef(onPolygonCommit);
  onPolygonCommitRef.current = onPolygonCommit;
  const onPolygonSelectRef = useRef(onPolygonSelect);
  onPolygonSelectRef.current = onPolygonSelect;
  const onVertexMoveRef = useRef(onVertexMove);
  onVertexMoveRef.current = onVertexMove;
  // 次に使う多角形 id
  const nextIdRef = useRef(0);
  nextIdRef.current = polygons.reduce((m, p) => Math.max(m, p.id), -1) + 1;

  // ── 座標変換ヘルパー(表示px → 画像px、ズーム考慮) ────────────────────────

  const dispToImage = (cx: number, cy: number, z: ZoomState) => ({
    x: (cx - z.tx) / z.scale / dsRef.current,
    y: (cy - z.ty) / z.scale / dsRef.current,
  });

  // 画像px → 表示スクリーンpx(ズーム考慮)
  const imageToScreen = (ix: number, iy: number, z: ZoomState) => ({
    sx: ix * dsRef.current * z.scale + z.tx,
    sy: iy * dsRef.current * z.scale + z.ty,
  });

  // ── 頂点ヒットテスト ────────────────────────────────────────────────────────

  const findNearVertex = (cx: number, cy: number) => {
    const selId = selectedIdRef.current;
    if (selId === null) return null;
    const poly = polygonsRef.current.find(p => p.id === selId);
    if (!poly) return null;
    const z = zoomRef.current;
    for (let i = 0; i < poly.points.length; i++) {
      const { sx, sy } = imageToScreen(poly.points[i][0], poly.points[i][1], z);
      if (Math.hypot(cx - sx, cy - sy) < VERTEX_HIT_PX) {
        return { polyId: selId, vIdx: i };
      }
    }
    return null;
  };

  // ── タップ処理 ─────────────────────────────────────────────────────────────

  const handleTap = (cx: number, cy: number) => {
    const z = zoomRef.current;
    const { x: imgX, y: imgY } = dispToImage(cx, cy, z);
    const pts = drawingRef.current;

    // 描画中なら頂点追加 or 閉じる
    if (pts.length > 0) {
      // 最初の頂点に近いかチェック(3頂点以上あれば閉じられる)
      if (pts.length >= 3) {
        const { sx: firstSx, sy: firstSy } = imageToScreen(pts[0][0], pts[0][1], z);
        if (Math.hypot(cx - firstSx, cy - firstSy) < CLOSE_DIST_PX) {
          onPolygonCommitRef.current({ id: nextIdRef.current, points: [...pts] });
          onDrawingChangeRef.current([]);
          return;
        }
      }
      onDrawingChangeRef.current([...pts, [imgX, imgY]]);
      return;
    }

    // 既存ポリゴンをタップで選択 or 選択解除
    const hit = polygonsRef.current
      .slice()
      .reverse()
      .find(p => pointInPoly(imgX, imgY, p.points));
    if (hit) {
      onPolygonSelectRef.current(hit.id === selectedIdRef.current ? null : hit.id);
    } else {
      onPolygonSelectRef.current(null);
      // 空白をタップ → 新規描画開始
      onDrawingChangeRef.current([[imgX, imgY]]);
    }
  };

  // ── ジェスチャー状態 ────────────────────────────────────────────────────────

  const gMode = useRef<GestureMode>('idle');
  const gStartCX = useRef(0);
  const gStartCY = useRef(0);
  const gStartZoom = useRef<ZoomState>({ scale: 1, tx: 0, ty: 0 });
  const gDragPolyId = useRef<number | null>(null);
  const gDragVIdx = useRef<number | null>(null);
  const gPinchDist0 = useRef(0);
  const gPinchMidX = useRef(0);
  const gPinchMidY = useRef(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt) => {
        const cx = evt.nativeEvent.locationX;
        const cy = evt.nativeEvent.locationY;
        gStartCX.current = cx;
        gStartCY.current = cy;
        gStartZoom.current = { ...zoomRef.current };

        // 頂点ドラッグ開始の判定(描画中は無効)
        if (drawingRef.current.length === 0) {
          const v = findNearVertex(cx, cy);
          if (v) {
            gMode.current = 'drag_vertex';
            gDragPolyId.current = v.polyId;
            gDragVIdx.current = v.vIdx;
            return;
          }
        }
        gMode.current = 'pending';
      },

      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;

        // ── ピンチ ──
        if (touches.length >= 2) {
          const d = touchDist(touches[0], touches[1]);
          const midX = (touches[0].locationX + touches[1].locationX) / 2;
          const midY = (touches[0].locationY + touches[1].locationY) / 2;
          if (gMode.current !== 'pinch') {
            gMode.current = 'pinch';
            gPinchDist0.current = d;
            gPinchMidX.current = midX;
            gPinchMidY.current = midY;
            gStartZoom.current = { ...zoomRef.current };
          }
          const { scale: s0, tx: tx0, ty: ty0 } = gStartZoom.current;
          const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s0 * d / gPinchDist0.current));
          // 焦点固定ズーム: ピンチ開始時の中点が画面上で同じ位置に留まるよう tx/ty を更新。
          const focalX = (gPinchMidX.current - tx0) / s0;
          const focalY = (gPinchMidY.current - ty0) / s0;
          setZoom({
            scale: newScale,
            tx: gPinchMidX.current - focalX * newScale,
            ty: gPinchMidY.current - focalY * newScale,
          });
          return;
        }

        if (gMode.current === 'pinch') return;

        // ── 頂点ドラッグ ──
        if (gMode.current === 'drag_vertex') {
          const z = zoomRef.current;
          const iw = imageWRef.current, ih = imageHRef.current;
          const { x, y } = dispToImage(gStartCX.current + gs.dx, gStartCY.current + gs.dy, z);
          onVertexMoveRef.current(
            gDragPolyId.current!,
            gDragVIdx.current!,
            Math.max(0, Math.min(x, iw)),
            Math.max(0, Math.min(y, ih)),
          );
          return;
        }

        // ── パン or 保留 ──
        if (gMode.current === 'pending') {
          if (Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD) {
            gMode.current = 'pan';
          }
        }
        if (gMode.current === 'pan') {
          const { scale, tx, ty } = gStartZoom.current;
          setZoom({ scale, tx: tx + gs.dx, ty: ty + gs.dy });
        }
      },

      onPanResponderRelease: (_, gs) => {
        if (gMode.current === 'pending') {
          // 移動量が閾値未満 → タップとして処理。
          if (Math.abs(gs.dx) < PAN_THRESHOLD && Math.abs(gs.dy) < PAN_THRESHOLD) {
            handleTap(gStartCX.current, gStartCY.current);
          }
        }
        gMode.current = 'idle';
        gDragPolyId.current = null;
        gDragVIdx.current = null;
      },

      onPanResponderTerminate: () => {
        gMode.current = 'idle';
        gDragPolyId.current = null;
        gDragVIdx.current = null;
      },
    })
  ).current;

  // ── Skia 描画データ(ポリゴンのパス)─────────────────────────────────────────
  // display 座標系(=画像px × ds)でパスを作り、Group の zoom transform で表示位置を調整する。

  const polyPaths = useMemo(() =>
    polygons.map(poly => {
      const p = Skia.Path.Make();
      if (poly.points.length < 1) return p;
      p.moveTo(poly.points[0][0] * ds, poly.points[0][1] * ds);
      for (let i = 1; i < poly.points.length; i++) {
        p.lineTo(poly.points[i][0] * ds, poly.points[i][1] * ds);
      }
      p.close();
      return p;
    }),
  [polygons, ds]);

  const drawPath = useMemo(() => {
    if (drawing.length === 0) return null;
    const p = Skia.Path.Make();
    p.moveTo(drawing[0][0] * ds, drawing[0][1] * ds);
    for (let i = 1; i < drawing.length; i++) {
      p.lineTo(drawing[i][0] * ds, drawing[i][1] * ds);
    }
    return p;
  }, [drawing, ds]);

  const groupTransform = [
    { translateX: zoom.tx },
    { translateY: zoom.ty },
    { scale: zoom.scale },
  ];

  // 確定ポリゴンの重心(スクリーン座標) - ラベル表示用
  const labelPositions = useMemo(() =>
    polygons.map(poly => {
      const [cx, cy] = centroid(poly.points);
      return {
        sx: cx * ds * zoom.scale + zoom.tx,
        sy: cy * ds * zoom.scale + zoom.ty,
      };
    }),
  [polygons, ds, zoom]);

  const selectedPoly = selectedId !== null ? polygons.find(p => p.id === selectedId) : null;

  return (
    <View
      style={[styles.container, { width: displayW, height: displayH }]}
      {...pan.panHandlers}
    >
      {/* ── Skia キャンバス ── */}
      <Canvas style={{ width: displayW, height: displayH }}>
        {/* 画像 + ポリゴンはすべて zoom Group 内で描く */}
        <Group transform={groupTransform}>
          {/* 背景除去済み画像 */}
          <SkiaImage
            image={image}
            x={0}
            y={0}
            width={imageW * ds}
            height={imageH * ds}
            fit="fill"
          />

          {/* 確定ポリゴン */}
          {polyPaths.map((path, idx) => {
            const c = POLY_COLORS[idx % POLY_COLORS.length];
            const isSel = polygons[idx].id === selectedId;
            return (
              <React.Fragment key={polygons[idx].id}>
                <Path path={path} color={c.fill} style="fill" />
                <Path path={path} color={c.border} style="stroke"
                  strokeWidth={(isSel ? 3 : 2) / zoom.scale} />
              </React.Fragment>
            );
          })}

          {/* 描画中パス */}
          {drawPath && (
            <Path path={drawPath} color="rgba(255,230,0,0.9)"
              style="stroke" strokeWidth={2 / zoom.scale} />
          )}
        </Group>

        {/* 頂点ドット・ハンドルはズームとは独立した固定サイズで描く(Group 外) */}

        {/* 描画中の頂点 */}
        {drawing.map(([px, py], i) => {
          const sx = px * ds * zoom.scale + zoom.tx;
          const sy = py * ds * zoom.scale + zoom.ty;
          const isFirst = i === 0 && drawing.length >= 3;
          return (
            <React.Fragment key={i}>
              <Circle cx={sx} cy={sy} r={isFirst ? 11 : 6} color={isFirst ? '#FFD600' : 'rgba(255,255,255,0.9)'} />
              <Circle cx={sx} cy={sy} r={isFirst ? 11 : 6} color={isFirst ? '#F57F00' : '#424242'}
                style="stroke" strokeWidth={1.5} />
            </React.Fragment>
          );
        })}

        {/* 選択中ポリゴンの頂点ハンドル */}
        {selectedPoly?.points.map(([px, py], vi) => {
          const sx = px * ds * zoom.scale + zoom.tx;
          const sy = py * ds * zoom.scale + zoom.ty;
          return (
            <React.Fragment key={vi}>
              <Circle cx={sx} cy={sy} r={8} color="rgba(255,255,255,0.9)" />
              <Circle cx={sx} cy={sy} r={8} color="#424242" style="stroke" strokeWidth={1.5} />
            </React.Fragment>
          );
        })}
      </Canvas>

      {/* ── ポリゴン連番ラベル(View オーバーレイ)── */}
      {labelPositions.map((pos, idx) => (
        <View
          key={polygons[idx].id}
          pointerEvents="none"
          style={[styles.labelBubble, { left: pos.sx - 14, top: pos.sy - 14 }]}
        >
          <Text style={styles.labelText}>{idx + 1}</Text>
        </View>
      ))}
    </View>
  );
}

// ── レイキャスティング法による点内判定 ──────────────────────────────────────

function pointInPoly(px: number, py: number, points: [number, number][]): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#808080',
    borderRadius: 4,
    overflow: 'hidden',
  },
  labelBubble: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
});
