// 手動矩形エディタ。
// ドラッグで矩形を追加、コーナーハンドルでリサイズ、内部ドラッグで移動。
// すべてのジェスチャーは PanResponder 1つで処理し、ハンドル判定は JS 側で行う。
import React, { useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { BBox } from './imaging';

export interface Rect {
  id: number;
  x: number; // 画像ピクセル座標(左上)
  y: number;
  w: number;
  h: number;
}

interface Props {
  imageUri: string;
  imageW: number;
  imageH: number;
  displayW: number;
  hints: BBox[];
  showHints: boolean;
  rects: Rect[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onChange: (rects: Rect[]) => void;
}

type Handle = 'TL' | 'TR' | 'BL' | 'BR';
type GestureMode = 'idle' | 'drawing' | 'moving' | 'resizing';

// コーナーハンドルのヒット判定半径(表示px)。指で触れるよう余裕を持たせる。
const HIT_R = 22;
// ハンドルの見た目サイズ(表示px)。
const HANDLE_VIS = 12;
// これ未満のドラッグは誤操作として無視(表示px)。
const MIN_DRAW_PX = 6;

const RECT_COLORS = [
  '#F44336', '#2196F3', '#4CAF50', '#FF9800',
  '#9C27B0', '#00BCD4', '#E91E63', '#795548',
  '#3F51B5', '#CDDC39', '#FFC107', '#009688',
  '#673AB7', '#FF5722',
];

// ── 純粋な計算関数（スケールを引数で受け取る）──────────────────────────────

function hitHandle(cx: number, cy: number, r: Rect, sc: number): Handle | null {
  const x1 = r.x * sc, y1 = r.y * sc;
  const x2 = (r.x + r.w) * sc, y2 = (r.y + r.h) * sc;
  const corners: [Handle, number, number][] = [
    ['TL', x1, y1], ['TR', x2, y1], ['BL', x1, y2], ['BR', x2, y2],
  ];
  for (const [h, hx, hy] of corners) {
    if (Math.abs(cx - hx) <= HIT_R && Math.abs(cy - hy) <= HIT_R) return h;
  }
  return null;
}

function hitRect(cx: number, cy: number, rects: Rect[], sc: number): Rect | null {
  const ix = cx / sc, iy = cy / sc;
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (ix >= r.x && ix <= r.x + r.w && iy >= r.y && iy <= r.y + r.h) return r;
  }
  return null;
}

function clamp(r: Rect, iw: number, ih: number): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.max(1, Math.min(r.w, iw - x));
  const h = Math.max(1, Math.min(r.h, ih - y));
  return { ...r, x, y, w, h };
}

function applyResize(snap: Rect, handle: Handle, ddx: number, ddy: number, iw: number, ih: number): Rect {
  let { x, y, w, h } = snap;
  switch (handle) {
    case 'TL': x += ddx; y += ddy; w -= ddx; h -= ddy; break;
    case 'TR':            y += ddy; w += ddx; h -= ddy; break;
    case 'BL': x += ddx;            w -= ddx; h += ddy; break;
    case 'BR':                       w += ddx; h += ddy; break;
  }
  // 対辺を超えてドラッグしたときに潰れないよう最小1pxを保証。
  if (w < 1) { x += w - 1; w = 1; }
  if (h < 1) { y += h - 1; h = 1; }
  return clamp({ ...snap, x, y, w, h }, iw, ih);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RectEditor({
  imageUri, imageW, imageH, displayW,
  hints, showHints, rects, selectedId, onSelect, onChange,
}: Props) {
  const displayH = (imageH / imageW) * displayW;

  // PanResponder の callback は最初のレンダーで生成されるため、
  // 変化する値はすべて ref を通じてアクセスする（stale closure 対策）。
  const scaleRef    = useRef(displayW / imageW);
  scaleRef.current  = displayW / imageW;
  const rectsRef    = useRef(rects);
  rectsRef.current  = rects;
  const selIdRef    = useRef(selectedId);
  selIdRef.current  = selectedId;
  const imgWRef     = useRef(imageW);
  imgWRef.current   = imageW;
  const imgHRef     = useRef(imageH);
  imgHRef.current   = imageH;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // ジェスチャー中の中間状態(draft)。commit は onRelease で onChange 経由。
  const [draft, setDraft] = useState<Rect | null>(null);

  const g = useRef<{
    mode: GestureMode;
    startCX: number;
    startCY: number;
    handle: Handle | null;
    snap: Rect | null;
  }>({ mode: 'idle', startCX: 0, startCY: 0, handle: null, snap: null });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => g.current.mode !== 'idle',

      onPanResponderGrant: (evt) => {
        const cx = evt.nativeEvent.locationX;
        const cy = evt.nativeEvent.locationY;
        const sc = scaleRef.current;
        const rs = rectsRef.current;
        const selId = selIdRef.current;
        const iw = imgWRef.current;
        const ih = imgHRef.current;
        g.current.startCX = cx;
        g.current.startCY = cy;

        // 選択中矩形のコーナーハンドル。
        if (selId !== null) {
          const sel = rs.find(r => r.id === selId);
          if (sel) {
            const h = hitHandle(cx, cy, sel, sc);
            if (h) {
              g.current.mode = 'resizing';
              g.current.handle = h;
              g.current.snap = { ...sel };
              return;
            }
          }
        }

        // 既存矩形の内部(移動)。
        const hit = hitRect(cx, cy, rs, sc);
        if (hit) {
          onSelectRef.current(hit.id);
          g.current.mode = 'moving';
          g.current.handle = null;
          g.current.snap = { ...hit };
          setDraft({ ...hit });
          return;
        }

        // 空白領域: 新規矩形を描画開始。
        const ix = Math.max(0, Math.min(cx / sc, iw));
        const iy = Math.max(0, Math.min(cy / sc, ih));
        const newId = rs.reduce((m, r) => Math.max(m, r.id), -1) + 1;
        onSelectRef.current(null);
        g.current.mode = 'drawing';
        g.current.handle = null;
        g.current.snap = { id: newId, x: ix, y: iy, w: 0, h: 0 };
        setDraft({ id: newId, x: ix, y: iy, w: 0, h: 0 });
      },

      onPanResponderMove: (_, gs) => {
        const { mode, snap, handle, startCX, startCY } = g.current;
        if (mode === 'idle' || !snap) return;
        const sc = scaleRef.current;
        const iw = imgWRef.current;
        const ih = imgHRef.current;

        if (mode === 'drawing') {
          const ix = startCX / sc, iy = startCY / sc;
          const dx = gs.dx / sc, dy = gs.dy / sc;
          const x = Math.max(0, Math.min(ix, ix + dx));
          const y = Math.max(0, Math.min(iy, iy + dy));
          setDraft({ id: snap.id, x, y, w: Math.min(Math.abs(dx), iw - x), h: Math.min(Math.abs(dy), ih - y) });
          return;
        }
        const ddx = gs.dx / sc, ddy = gs.dy / sc;
        if (mode === 'moving') {
          setDraft(clamp({ ...snap, x: snap.x + ddx, y: snap.y + ddy }, iw, ih));
        } else if (mode === 'resizing' && handle) {
          setDraft(applyResize(snap, handle, ddx, ddy, iw, ih));
        }
      },

      onPanResponderRelease: (_, gs) => {
        const { mode, snap, handle, startCX, startCY } = g.current;
        const rs = rectsRef.current;
        const sc = scaleRef.current;
        const iw = imgWRef.current;
        const ih = imgHRef.current;

        if (mode === 'drawing' && snap) {
          if (Math.abs(gs.dx) >= MIN_DRAW_PX && Math.abs(gs.dy) >= MIN_DRAW_PX) {
            const ix = startCX / sc, iy = startCY / sc;
            const dx = gs.dx / sc, dy = gs.dy / sc;
            const x = Math.max(0, Math.min(ix, ix + dx));
            const y = Math.max(0, Math.min(iy, iy + dy));
            const newRect: Rect = { id: snap.id, x, y, w: Math.min(Math.abs(dx), iw - x), h: Math.min(Math.abs(dy), ih - y) };
            onChangeRef.current([...rs, newRect]);
            onSelectRef.current(snap.id);
          }
        } else if ((mode === 'moving' || mode === 'resizing') && snap) {
          const ddx = gs.dx / sc, ddy = gs.dy / sc;
          const updated = mode === 'moving'
            ? clamp({ ...snap, x: snap.x + ddx, y: snap.y + ddy }, iw, ih)
            : applyResize(snap, handle!, ddx, ddy, iw, ih);
          onChangeRef.current(rs.map(r => r.id === snap.id ? updated : r));
          onSelectRef.current(snap.id);
        }

        setDraft(null);
        g.current.mode = 'idle';
        g.current.snap = null;
        g.current.handle = null;
      },

      onPanResponderTerminate: () => {
        setDraft(null);
        g.current.mode = 'idle';
        g.current.snap = null;
        g.current.handle = null;
      },
    })
  ).current;

  const scale = scaleRef.current;

  // コミット済み矩形 + draft を合成して表示。
  const displayed: Rect[] = draft
    ? [...rects.filter(r => r.id !== draft.id), draft]
    : rects;

  return (
    <View
      style={[styles.canvas, { width: displayW, height: displayH }]}
      {...pan.panHandlers}
    >
      {/* 背景除去済み画像（pointerEvents は親 View の PanResponder が全部受け取るので不要）*/}
      <Image
        source={{ uri: imageUri }}
        style={{ width: displayW, height: displayH }}
        resizeMode="contain"
      />

      {/* 自動分割ヒント（薄い破線）*/}
      {showHints && hints.map((bb, i) => (
        <View
          key={`hint-${i}`}
          pointerEvents="none"
          style={[styles.hintRect, {
            left: bb.minX * scale,
            top: bb.minY * scale,
            width: (bb.maxX - bb.minX + 1) * scale,
            height: (bb.maxY - bb.minY + 1) * scale,
          }]}
        />
      ))}

      {/* 手動矩形 */}
      {displayed.map((r) => {
        const commitIdx = rects.findIndex(cr => cr.id === r.id);
        const isDraft = r.id === draft?.id && g.current.mode !== 'idle';
        const isSel = r.id === selectedId && !isDraft;
        const color = RECT_COLORS[commitIdx >= 0 ? commitIdx % RECT_COLORS.length : 0];
        const borderColor = isDraft ? '#FFD600' : isSel ? '#FFFFFF' : color;
        const bg = isDraft ? 'rgba(255,214,0,0.15)' : `${color}38`;

        return (
          <View
            key={r.id}
            pointerEvents="none"
            style={[styles.rect, {
              left: r.x * scale,
              top: r.y * scale,
              width: Math.max(1, r.w * scale),
              height: Math.max(1, r.h * scale),
              borderColor,
              borderWidth: isSel ? 3 : 2,
              backgroundColor: bg,
            }]}
          >
            {/* 連番ラベル */}
            {commitIdx >= 0 && (
              <Text style={styles.label}>{commitIdx + 1}</Text>
            )}

            {/* 選択中コーナーハンドル（視覚のみ・タッチは親 PanResponder で処理）*/}
            {isSel && (
              <>
                <View style={[styles.handle, styles.hTL]} />
                <View style={[styles.handle, styles.hTR]} />
                <View style={[styles.handle, styles.hBL]} />
                <View style={[styles.handle, styles.hBR]} />
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

const H = HANDLE_VIS;
const HALF = H / 2;

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: '#BDBDBD',
    borderRadius: 4,
    overflow: 'hidden',
  },
  hintRect: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    borderStyle: 'dashed',
  },
  rect: {
    position: 'absolute',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  handle: {
    position: 'absolute',
    width: H,
    height: H,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: '#424242',
  },
  hTL: { top: -HALF, left: -HALF },
  hTR: { top: -HALF, right: -HALF },
  hBL: { bottom: -HALF, left: -HALF },
  hBR: { bottom: -HALF, right: -HALF },
});
