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
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Animated, {
  useDerivedValue,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useT } from '../../i18n';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  ImageShader,
  Line,
  Path,
  Rect,
  Circle,
  Skia,
  vec,
  FilterMode,
  MipmapMode,
} from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';

/** ルーペの1辺(px)の既定値。呼び出し側は size prop で変えられる。 */
export const LOUPE_SIZE = 116;
/**
 * ルーペ内での最終的な表示倍率（キャンバスの倍率と同じ尺度）。
 *
 * 「表示倍率 = 現在のズーム倍率 × ルーペ倍率」を一定に保ちたい、という要件は、
 * このルーペが元画像を直接拡大している以上、最終倍率をそのまま定数で持つのと
 * 同じことになる。キャンバスが ×1 でも ×8 でも、ルーペの中身は常に ×24 で、
 * ユーザーから見た「ルーペ内の大きさ」が変わらない。
 */
export const LOUPE_MAGNIFY = 24;
/** 指がこの距離(表示px)までルーペに近づいたら反対側へ逃がす。 */
const AVOID_MARGIN = 24;
/**
 * 上部のコントロール行（下地切替・ズーム）の下に出すための余白の既定値。
 * 上端に出すと、そのまま操作パネルと重なって両方見えなくなる。
 */
export const LOUPE_TOP_OFFSET = 52;

/** 十字ボタン1マスの一辺(px)。ボタン本体はここから margin ぶん引いた大きさになる。 */
const DPAD_CELL = 58;
/** 十字ボタン(D-pad)全体の幅(px)。3列ぶん。中央寄せに使う。 */
const DPAD_W = DPAD_CELL * 3;

/**
 * ルーペのサイズ段階。iOS の動画ピクチャー・イン・ピクチャーのように、
 * 好きな時に小さく収納できるようにする。ボタン1つで循環する。
 *   0 'default' … 呼び出し側が渡した size/fullWidth をそのまま使う
 *                 （adjust モードなら大きく・全幅、fixed モードなら通常サイズ）。
 *   1 'compact' … LOUPE_SIZE 固定の正方形（指を避ける隅寄せは有効）。
 *   2 'docked'  … 画面左端に小さく寄せ、半分ほど画面外へ逃がす
 *                 （PinP を左端へスワイプした時のような「収納」見た目）。
 */
export type DockLevel = 0 | 1 | 2;
export const DOCK_COMPACT_SIZE = LOUPE_SIZE;
export const DOCK_DOCKED_SIZE = 64;
/**
 * 収納時、左端からどれだけ画面外へ逃がすか(px)。PinP のように「半分だけ
 * 隠れる」を狙う。8pxしか出さない案は矢印ごと隠れて押しづらかったため、
 * 半分(32px)は画面内に残し、矢印がちゃんと見える/押せるようにする。
 */
const DOCK_DOCKED_HIDE = DOCK_DOCKED_SIZE / 2;
const DOCK_ANIM_MS = 260;

/** panZoomSV に渡す値の形。PolygonEditor の ZoomState と同じ形。 */
interface ZoomLike { scale: number; tx: number; ty: number }

interface Props {
  /** 拡大して見せる画像。親が描画に使っているものをそのまま渡す。 */
  image: SkImage | null;
  /** 画像1pxあたりの表示px（親の ds）。ルーペ内の倍率は ds × magnify になる。 */
  ds: number;
  /** 注目点（画像座標）。null ならルーペを出さない。 */
  point: { x: number; y: number } | null;
  /** 指の表示座標。ルーペを避けさせるためだけに使う。 */
  touch: { x: number; y: number } | null;
  /** キャンバスの表示サイズ。左右どちらへ置くか・D-padの中央寄せに使う。 */
  canvasW: number;
  /**
   * キャンバスの高さ。panZoomSV と組み合わせて「キャンバス中央に今ある
   * 画像座標」を UI スレッド側で計算するために使う（panZoomSV 未指定なら不要）。
   */
  canvasH?: number;
  /**
   * 渡すと、ルーペの中身をこの共有値から直接（UI スレッドで）追従させる。
   * reticleFixed（レティクル中央固定でパンする方式）の時に使う。
   *
   * 通常は point prop の更新（React state 経由、rAFで1フレーム1回）で
   * ルーペを動かしているが、それでも JS スレッドの再レンダーを挟む以上
   * わずかな遅れが出る。パン操作自体は zoomSV（Reanimated 共有値）で
   * UI スレッドだけを使って毎フレーム完全になめらかに動いているので、
   * ルーペの中身も同じ共有値から直接計算すれば、React の再レンダーを
   * 一切挟まずに全く同じなめらかさで追従できる。
   * この場合 point は「キャンバス中央の画像座標」の意味だが、実際の
   * 描画位置計算には使わず、panZoomSV から毎フレーム再計算する
   * （point は他の用途 — null 判定・パン開始前の初期表示 — のためだけに残す）。
   */
  panZoomSV?: SharedValue<ZoomLike>;
  /** 市松模様。渡すと透過部分が分かりやすくなる。 */
  checkerImage?: SkImage | null;
  checkerTile?: number;
  /**
   * レティクル中心に重ねる円の半径（画像px）。復元ブラシの太さを示す。
   * 省略すると十字だけになる。
   */
  brushRadius?: number;
  /**
   * 復元ブラシでなぞっている最中の軌跡（画像座標）。渡すと、メインキャンバスの
   * プレビューと同じ緑の線をルーペの中にも重ねて描く。ルーペは拡大表示なので、
   * 実寸だと「今どこを塗ったか」が分かりにくく、特に adjust モードの録画方式
   * （パンで軌跡を作る）では手元のキャンバスに線が出ていても遠目には
   * 気づきにくいため、拡大された絵の上にも同じ線を出す。
   */
  strokePoints?: Array<[number, number]>;
  magnify?: number;
  /** ルーペの高さ(px)。既定 LOUPE_SIZE。ズームバーを畳んだ時など、大きくして見やすくする用途。 */
  size?: number;
  /** ルーペ上端の位置(px)。既定 LOUPE_TOP_OFFSET。 */
  topOffset?: number;
  /**
   * true にすると、指を避ける隅寄せをやめてキャンバス全幅（左右とも8px余白）に
   * 引き伸ばす。'adjust' モードでは十字ボタンで狙いを追い込むため、ルーペ自体は
   * 大きく・常に同じ場所にある方が見やすい（指を避けて左右に飛ぶと逆に目で追う
   * 必要が出て使いにくい）。
   */
  fullWidth?: boolean;
  /**
   * 渡すと、ルーペの下・キャンバス中央に十字ボタン(D-pad)を出す。
   * 押すたびに (dx,dy) 単位（-1/0/1）で呼ばれる。長押しでの連続移動は
   * このコンポーネント側で行う（呼び出し側は1回分の移動だけ実装すればよい）。
   * 中央のキャンバス幅基準で常に真ん中に置く（ルーペ自体は指を避けて
   * 左右に飛ぶが、D-padまで一緒に飛ぶと押す指の位置を毎回探すことになるため、
   * ここだけは動かさない）。
   * 'adjust' モードの時だけ渡す想定（'fixed' では出さない）。
   *
   * レティクルは常にルーペの中心にある。呼び出し側が「レティクルの位置」を
   * 唯一の正として持ち、動いた結果を point として渡し直す設計なので、
   * このコンポーネント側にずれを持たせる必要はない。
   */
  onNudge?: (dx: number, dy: number) => void;
  /**
   * 渡すと「決定」ボタンを出す。指を離さなくても、今のレティクル位置で
   * その場の操作（例: スポイト）を確定させる。ツール（復元ブラシ）によっては
   * 1回で確定せず、書き始め／書き終わりのトグルとして使う
   * （その場合は decideActive で「今書いている最中」を示す）。
   */
  onDecide?: () => void;
  /**
   * true の間、決定ボタンを「実行中」の見た目（赤・点滅ではなく単色反転）にする。
   * 復元ブラシの録画中トグルのように、決定ボタンが on/off を持つ場合に使う。
   * 渡さない（undefined）場合は常に通常表示。
   */
  decideActive?: boolean;
  /**
   * decideActive 中のラベル／アイコンの意味。復元ブラシは「録画中」、
   * move モードの頂点選択トグルは「選択中」で、見た目の意味が違うため
   * 呼び出し側で切り替えられるようにする。省略時は 'recording'（従来動作）。
   */
  decideActiveKind?: 'recording' | 'selected';
  /**
   * D-padを画面下端からの距離(px)で固定する。指定すると「ルーペのすぐ下」
   * 追従ではなく、常に同じ場所（下部の説明表示のすぐ上）に置く。
   * 画面中央付近は編集そのものの邪魔になるため、下部に逃がす。
   */
  dpadBottom?: number;
  /**
   * ルーペ本体タップでの収納段階（0=既定/1=コンパクト/2=ドック）。
   * 呼び出し側が state を持つ制御コンポーネント形式にしてある。理由は、
   * ルーペのすぐ下・横に続く他のUI（ズームバー・ツールメニュー）の配置が
   * 段階ごとに大きく変わるため、呼び出し側がこの値を持っていないと
   * レイアウトを追従させられないのと、既定の段階をモードごとに変えたい
   * （'adjust' 設定は大サイズ、それ以外は中サイズから始める、など）ため。
   * 省略時は 0（内部で state を持たず常に既定サイズ）扱い。
   */
  dockLevel?: DockLevel;
  /** ルーペ本体タップで次の段階へ進めたい時に呼ぶ（次の値を渡す）。 */
  onDockLevelChange?: (level: DockLevel) => void;
}

export default function TouchLoupe({
  image,
  ds,
  point,
  touch,
  canvasW,
  canvasH,
  checkerImage,
  checkerTile = 8,
  brushRadius,
  strokePoints,
  magnify = LOUPE_MAGNIFY,
  size = LOUPE_SIZE,
  topOffset = LOUPE_TOP_OFFSET,
  fullWidth = false,
  onNudge,
  onDecide,
  decideActive = false,
  decideActiveKind = 'recording',
  dpadBottom,
  dockLevel = 0,
  onDockLevelChange,
  panZoomSV,
}: Props) {
  const { t } = useT();
  // 長押しでの連続移動用タイマー。setState を伴わないので描画には影響しない。
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRepeat = () => {
    if (repeatTimer.current != null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  };
  const startRepeat = (dx: number, dy: number) => {
    onNudge?.(dx, dy);
    stopRepeat();
    // 最初の1回はすぐ反映し、少し間を置いてから連続移動に入る
    // （タップのつもりが2回分動いてしまうのを防ぐ）。
    repeatTimer.current = setTimeout(() => {
      repeatTimer.current = setInterval(() => onNudge?.(dx, dy), 80);
    }, 350) as unknown as ReturnType<typeof setInterval>;
  };

  /**
   * PinP 風のサイズ収納。ボタンで 0→1→2→0 と循環する。呼び出し側が state を
   * 持つ制御コンポーネント形式（上の dockLevel prop 参照）。
   */
  const cycleDock = () => onDockLevelChange?.(((dockLevel + 1) % 3) as DockLevel);

  // level に応じて実際のサイズ・隅寄せの有無を決める。default(0) だけ
  // 呼び出し側の size/fullWidth をそのまま使う。
  const effSize = dockLevel === 1 ? DOCK_COMPACT_SIZE
    : dockLevel === 2 ? DOCK_DOCKED_SIZE
    : size;
  const effFullWidth = dockLevel === 0 ? fullWidth : false;

  // fullWidth の時はキャンバス全幅(左右8pxずつ余白)に伸ばす。指を避ける
  // 隅寄せは行わない（伸ばした時点でどちらの隅も同じ位置になるため無意味）。
  // point が無い(null)時にも呼べるよう、この先は point?.x ?? 0 で安全に扱う
  // （フックは早期 return より前で呼ぶ必要があるため、null チェックはここでは
  // できない。実際に画面に何も描かないのは return null の分岐で行う）。
  const boxW = effFullWidth ? Math.max(0, canvasW - 16) : effSize;
  const boxH = effSize;
  const scale = ds * magnify;
  const cx = boxW / 2;
  const cy = boxH / 2;
  const tx = cx - (point?.x ?? 0) * scale;
  const ty = cy - (point?.y ?? 0) * scale;

  /**
   * ルーペの中身を動かす Group の transform。
   * panZoomSV が無ければ従来どおり point から計算した固定値（React の
   * 再レンダー任せ）。panZoomSV がある（reticleFixed でパン中）時は、
   * 「今キャンバス中央にある画像座標」を毎フレーム UI スレッドで計算し直す
   * ワークレットにする。JS スレッドの再レンダーを経由しないので、
   * メインキャンバスのパンと完全に同じなめらかさで追従する。
   */
  const groupTransform = useDerivedValue(() => {
    'worklet';
    if (panZoomSV && canvasH != null) {
      const z = panZoomSV.value;
      const refX = canvasW / 2;
      const refY = canvasH / 2;
      const imgX = (refX - z.tx) / (ds * z.scale);
      const imgY = (refY - z.ty) / (ds * z.scale);
      return [
        { translateX: cx - imgX * scale },
        { translateY: cy - imgY * scale },
        { scale: magnify },
      ];
    }
    return [
      { translateX: tx },
      { translateY: ty },
      { scale: magnify },
    ];
  }, [panZoomSV, canvasW, canvasH, ds, scale, cx, cy, tx, ty, magnify]);

  /**
   * 復元ブラシの軌跡プレビュー。メインキャンバス側（PolygonEditor の
   * strokePath）と同じ組み立て方にする。座標は SkiaImage と同じ
   * 「ds 倍済みの自然サイズ」空間（Group の外側の scale=magnify で
   * さらに拡大される）にしておくことで、magnify を通しても画像とズレない。
   */
  const strokePath = useMemo(() => {
    if (!strokePoints || strokePoints.length === 0) return null;
    const p = Skia.Path.Make();
    p.moveTo(strokePoints[0][0] * ds, strokePoints[0][1] * ds);
    for (let i = 1; i < strokePoints.length; i++) {
      p.lineTo(strokePoints[i][0] * ds, strokePoints[i][1] * ds);
    }
    if (strokePoints.length === 1) {
      p.lineTo(strokePoints[0][0] * ds + 0.01, strokePoints[0][1] * ds);
    }
    return p;
  }, [strokePoints, ds]);

  // 既定は左。指が左側に来たら右へ逃がす。
  // 上下ではなく左右だけで逃がすのは、上に操作パネル、下にツール説明と
  // ブラシ設定があり、縦に動かすとどちらかと重なるため。
  // 収納(level2)は常に左端固定＋画面外へ半分逃がす。隅寄せ判定は無意味なので行わない。
  const nearLeft = dockLevel === 0 && !effFullWidth && touch != null
    && touch.x < boxW + AVOID_MARGIN
    && touch.y < topOffset + boxH + AVOID_MARGIN;
  const left = dockLevel === 2
    ? -DOCK_DOCKED_HIDE
    : (effFullWidth ? 8 : (nearLeft ? canvasW - boxW - 8 : 8));

  /**
   * left の変化（隅の逃げ／収納の出し入れ）をなめらかにアニメーションする。
   * サイズ(boxW/boxH)自体は Skia 側の再計算が絡むのでアニメーションせず
   * 即座に切り替える（そのぶん、収納ボタンを押した瞬間に中身はスナップする）
   * ————代わりに popScale で「ポン」と一瞬伸縮させ、切り替わったこと自体は
   * 分かるようにする。位置のスライドは正真正銘なめらかに動くので、
   * 「左へ収納される」動き自体はアニメーション付きに見える。
   */
  const leftSV = useSharedValue(left);
  const popScale = useSharedValue(1);
  const prevDockLevel = useRef(dockLevel);
  useEffect(() => {
    leftSV.value = withTiming(left, { duration: DOCK_ANIM_MS, easing: Easing.out(Easing.cubic) });
    if (prevDockLevel.current !== dockLevel) {
      prevDockLevel.current = dockLevel;
      popScale.value = 0.85;
      popScale.value = withTiming(1, { duration: DOCK_ANIM_MS, easing: Easing.out(Easing.back(1.5)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, dockLevel]);
  const dockAnimStyle = useAnimatedStyle(() => ({
    left: leftSV.value,
    transform: [{ scale: popScale.value }],
  }));

  if (!image || !point) return null;

  // レティクルは常にルーペのど真ん中。十字ボタンで動かすのは「レティクルの
  // 位置」そのもの（＝ point）で、その結果を呼び出し側が渡し直してくるため、
  // ここで照準をずらす必要はない。中心固定にすることで「ルーペの中央＝
  // これから編集される場所」という読み方が最後まで崩れない（cx/cy/tx/ty は上で計算済み）。

  const reticle = brushRadius != null
    ? Math.max(2, brushRadius * scale)
    : null;

  // decideActive中は色を反転させ、「今はトグルがONの状態」だと分かるように
  // する。意味はケースによって違う（復元ブラシ＝録画中／moveモード＝選択中）
  // ので、decideActiveKind でラベル・アイコンを切り替える。
  const decideButton = onDecide && (
    <Pressable
      style={[styles.decideBtn, decideActive && styles.decideBtnActive]}
      onPress={onDecide}
    >
      <Icon
        name={!decideActive ? 'check' : (decideActiveKind === 'selected' ? 'close' : 'fiber-manual-record')}
        size={decideActive ? 18 : 22}
        color="#FFF"
      />
      <Text style={styles.decideBtnTxt}>
        {!decideActive ? t('editor.reticleDecide')
          : (decideActiveKind === 'selected' ? t('editor.reticleSelected') : t('editor.reticleRecording'))}
      </Text>
    </Pressable>
  );

  return (
    <>
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        dockAnimStyle,
        { top: topOffset, width: boxW, height: boxH },
        // 小(docked)状態は半分が画面外で中身(市松/画像)を見せても意味が
        // 薄いので、薄暗い黒一色の「タブ」に切り替える。
        dockLevel === 2 && styles.wrapDocked,
      ]}
    >
      {dockLevel === 2 ? (
        // 小(docked): 中身は描かず、矢印だけの薄暗いタブにする。ボックス
        // 全体（画面外の半分含む）をタップ対象にし、hitSlopでさらに右へ
        // 広げることで、矢印を含む見えている部分を押しやすくする。
        <Pressable
          style={styles.dockedFill}
          onPress={cycleDock}
          hitSlop={{ top: 20, bottom: 20, left: 0, right: 28 }}
        >
          <Icon name="chevron-right" size={20} color="rgba(255,255,255,0.9)" />
        </Pressable>
      ) : (
        <>
          <Canvas style={styles.canvas} pointerEvents="none">
            {/* 透過部分が分かるよう市松を敷く */}
            {checkerImage ? (
              <Rect x={0} y={0} width={boxW} height={boxH}>
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
              <Rect x={0} y={0} width={boxW} height={boxH} color="#3A3A3C" />
            )}

            <Group transform={groupTransform}>
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
              {/* 復元ブラシの軌跡プレビュー。メインキャンバスの緑の線と同じ色。
                  太さは ds だけ掛けておく（magnify は Group の scale が担う）。 */}
              {strokePath && (
                <Path
                  path={strokePath}
                  color="rgba(52,199,89,0.7)"
                  style="stroke"
                  strokeWidth={Math.max(0.5, (brushRadius ?? 1) * 2 * ds)}
                  strokeCap="round"
                  strokeJoin="round"
                />
              )}
            </Group>

            {/* レティクル。ここが実際の編集位置。ブラシ円も一緒に動く。 */}
            {reticle != null && (
              <Circle cx={cx} cy={cy} r={reticle} color="rgba(52,199,89,0.30)" />
            )}
            <Line p1={vec(cx - 10, cy)} p2={vec(cx - 3, cy)} color="#FFF" strokeWidth={1} />
            <Line p1={vec(cx + 3, cy)} p2={vec(cx + 10, cy)} color="#FFF" strokeWidth={1} />
            <Line p1={vec(cx, cy - 10)} p2={vec(cx, cy - 3)} color="#FFF" strokeWidth={1} />
            <Line p1={vec(cx, cy + 3)} p2={vec(cx, cy + 10)} color="#FFF" strokeWidth={1} />
          </Canvas>

          {/* ルーペ本体タップで収納サイズを進める（大→中→小→大…とループ）。
              隅の小さいボタンは当たり判定が半分はみ出て押しづらかったため
              廃止し、ルーペ全体をタップターゲットにした。パン中は指を
              ルーペから避ける位置に逃がしてある（nearLeft 判定）ので、
              パン操作とは衝突しない。 */}
          <Pressable style={StyleSheet.absoluteFill} onPress={cycleDock} />
        </>
      )}
    </Animated.View>

    {/* 十字ボタン＋決定。キャンバス幅の中央に固定する（ルーペのように左右へは
        飛ばさない）。ルーペ本体は pointerEvents="none" なので、押せるのは
        ここだけ。中央のマスは「決定」。十字の真ん中は元々そこを押したくなる
        場所なので、実際に確定として機能するボタンを置くのが素直（以前ここに
        置いていたリセットは、押しても確定しないので壊れているように見えていた）。
        onNudge が無い（復元ブラシ等、中央固定パンの対象外のツール）時は
        矢印を出さず、決定だけを1個の丸ボタンとして出す。 */}
    {(onNudge || onDecide) && (
      <View
        pointerEvents="box-none"
        style={[
          styles.dpadWrap,
          dpadBottom != null
            ? { left: canvasW / 2 - DPAD_W / 2, bottom: dpadBottom }
            : { left: canvasW / 2 - DPAD_W / 2, top: topOffset + size + 6 },
        ]}>
        {onNudge ? (
          <>
            <View style={styles.dpadRow}>
              <View style={styles.dpadSpacer} />
              <Pressable
                style={styles.dpadBtn}
                onPressIn={() => startRepeat(0, -1)}
                onPressOut={stopRepeat}>
                <Icon name="keyboard-arrow-up" size={32} color="#FFF" />
              </Pressable>
              <View style={styles.dpadSpacer} />
            </View>
            <View style={styles.dpadRow}>
              <Pressable
                style={styles.dpadBtn}
                onPressIn={() => startRepeat(-1, 0)}
                onPressOut={stopRepeat}>
                <Icon name="keyboard-arrow-left" size={32} color="#FFF" />
              </Pressable>
              {onDecide ? decideButton : <View style={styles.dpadSpacer} />}
              <Pressable
                style={styles.dpadBtn}
                onPressIn={() => startRepeat(1, 0)}
                onPressOut={stopRepeat}>
                <Icon name="keyboard-arrow-right" size={32} color="#FFF" />
              </Pressable>
            </View>
            <View style={styles.dpadRow}>
              <View style={styles.dpadSpacer} />
              <Pressable
                style={styles.dpadBtn}
                onPressIn={() => startRepeat(0, 1)}
                onPressOut={stopRepeat}>
                <Icon name="keyboard-arrow-down" size={32} color="#FFF" />
              </Pressable>
              <View style={styles.dpadSpacer} />
            </View>
          </>
        ) : (
          onDecide && decideButton
        )}
      </View>
    )}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 3,
    // サイズ(大/中/小)に関わらず共通。ズームバー/ツールメニューの浮き出し
    // パネルと同じ色にして、操作パネル群として統一感を出す。
    borderColor: 'rgba(30,30,30,0.78)',
    backgroundColor: '#000',
    // 影を付けて背景から浮かせる。fullWidth の時は上端いっぱいに広がるので、
    // 縁取りだけだと同化しやすい暗い絵の上でも輪郭がはっきり見えるようにする。
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  canvas: { flex: 1 },

  // 小(docked)状態: 中身の市松/画像の代わりに薄暗い黒一色にし、ボーダーも
  // 目立たない色に落とす（常時見えている「タブ」としての控えめさを出す）。
  wrapDocked: {
    // ズームバー/ツールメニューの浮き出しパネルと同じ背景色に揃える。
    backgroundColor: 'rgba(30,30,30,0.78)',
    // ボーダーは共通(wrap.borderColor)のまま — 色をここで上書きしない。
  },
  // 矢印を右端（＝画面に見えている縁のあたり）に寄せて表示する。
  dockedFill: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 4,
  },

  // 十字ボタン一式(3列グリッド)。
  dpadWrap: {
    position: 'absolute',
    width: DPAD_W,
    alignItems: 'center',
  },
  dpadRow: { flexDirection: 'row' },
  dpadBtn: {
    width: DPAD_CELL - 6,
    height: DPAD_CELL - 6,
    borderRadius: (DPAD_CELL - 6) / 2,
    margin: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  dpadSpacer: { width: DPAD_CELL, height: DPAD_CELL },
  // 決定。十字の中央マス。移動ボタン(暗いグレー)と区別できるよう青系にする。
  decideBtn: {
    width: DPAD_CELL - 6,
    height: DPAD_CELL - 6,
    borderRadius: (DPAD_CELL - 6) / 2,
    margin: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,122,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  // 録画中（復元ブラシ）。青→赤にして「押しっぱなし中」と混同しない見た目にする。
  decideBtnActive: {
    backgroundColor: 'rgba(255,59,48,0.95)',
  },
  decideBtnTxt: {
    color: '#FFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
