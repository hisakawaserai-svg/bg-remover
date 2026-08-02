"""BirdMascot(day/night/sleep) を 1024px のアプリアイコン PNG として書き出す。

src/components/onboarding/BirdMascot.tsx の 100x100 座標系をそのまま使い、
背景の丸のかわりに全面をシーン色で塗る(アイコンは全面ベタ塗り)。
4倍でレンダリングして縮小することでアンチエイリアスをかける。
"""
import os
import sys
from PIL import Image, ImageDraw

OUT = 1024
SS = 4                      # supersampling
S = OUT * SS / 100.0        # 100基準 → ピクセル

# キャラ本体は少し縮めて中央に置く(全面ベタ塗りのアイコンで端が切れないように)
CHAR_SCALE = 0.78
PIVOT = (50.0, 54.0)
_char = False               # True の間だけ縮小変換を適用

# 描画物(背景以外)全体の縮小率。Android のアダプティブアイコンでは
# セーフゾーン内に収めるため 0.66 にする。背景は常に全面。
_scene = 1.0


def T(x, y):
    if _char:
        x = PIVOT[0] + (x - PIVOT[0]) * CHAR_SCALE
        y = PIVOT[1] + (y - PIVOT[1]) * CHAR_SCALE
    if _scene != 1.0:
        x = 50 + (x - 50) * _scene
        y = 50 + (y - 50) * _scene
    return x, y


def P(*xy):
    return [tuple(v * S for v in T(x, y)) for x, y in xy]


def box(x, y, w, h):
    x0, y0 = T(x, y)
    x1, y1 = T(x + w, y + h)
    return [x0 * S, y0 * S, x1 * S, y1 * S]


def circle(d, cx, cy, r, color):
    d.ellipse(box(cx - r, cy - r, r * 2, r * 2), fill=color)


def line(d, pts, color, w, joint='curve'):
    lw = w * _scene * (CHAR_SCALE if _char else 1.0)
    d.line(P(*pts), fill=color, width=int(round(lw * S)), joint=joint)
    # strokeCap='round' 相当: 端点に丸をのせる
    for x, y in pts:
        circle(d, x, y, w / 2, color)


def star(d, cx, cy, r, color, waist=0.26):
    """4方向にとがったきらきら星。"""
    w = r * waist
    d.polygon(P((cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
                (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)),
              fill=color)


def quad(d, p0, p1, p2, color, w, n=24):
    """2次ベジェ(Q)を折れ線で近似。"""
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    line(d, pts, color, w)


CHECKER_CELL = 64           # 1024px 基準のマス目(=16マス)。小さすぎるとつぶれる
CHECKER_LIGHT = (255, 255, 255)
CHECKER_DARK = (222, 222, 228)
# グラデーションの効き始め/効き終わり(左上→右下の対角位置 0..1)
FADE_FROM, FADE_TO = 0.34, 1.02


def background(bg):
    """左上はシーン色、右下へ向かって透明チェッカーへ自然に変わる背景。

    透明化アプリらしさを出すためのもの。チェッカーは 2 色のコントラストを
    抑えてあり、アイコンサイズでもうるさくならない。
    """
    base = Image.new('RGB', (OUT, OUT), bg)

    checker = Image.new('RGB', (OUT, OUT), CHECKER_LIGHT)
    cd = ImageDraw.Draw(checker)
    n = OUT // CHECKER_CELL
    for iy in range(n):
        for ix in range(n):
            if (ix + iy) % 2:
                cd.rectangle([ix * CHECKER_CELL, iy * CHECKER_CELL,
                              (ix + 1) * CHECKER_CELL - 1,
                              (iy + 1) * CHECKER_CELL - 1], fill=CHECKER_DARK)

    # 対角グラデーションのマスク(粗く作って拡大＝なめらか)
    m = 128
    mask = Image.new('L', (m, m))
    px = mask.load()
    for y in range(m):
        for x in range(m):
            t = (x + y) / (2 * (m - 1))
            t = (t - FADE_FROM) / (FADE_TO - FADE_FROM)
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            px[x, y] = int(round(255 * t * t * (3 - 2 * t)))   # smoothstep
    mask = mask.resize((OUT, OUT), Image.BICUBIC)

    return Image.composite(checker, base, mask).resize(
        (OUT * SS, OUT * SS), Image.NEAREST)


def punch_circle(img, cx, cy, r, color, hx, hy, hr):
    """円を描いて一部を丸くくり抜く(三日月)。背景が一様でないので合成で作る。"""
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse(box(cx - r, cy - r, r * 2, r * 2), fill=color)
    ld.ellipse(box(hx - hr, hy - hr, hr * 2, hr * 2), fill=(0, 0, 0, 0))
    img.alpha_composite(layer)


def draw(variant, scene=1.0, size=OUT):
    global _scene
    _scene = scene
    bg = {'day': '#BFE6FF', 'night': '#1E2A55', 'sleep': '#B8B5E8'}[variant]
    img = background(bg).convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')

    # ─ シーン ─
    if variant == 'day':
        circle(d, 78, 24, 11, '#FFD23F')
    elif variant == 'night':
        punch_circle(img, 76, 24, 11, '#F3ECC4', 71, 21, 10)   # 三日月
        # きらきら星(4方向のとがった星)＋small な丸星を散らす
        star(d, 26, 22, 5.0, '#FFFFFF')
        star(d, 15, 44, 3.2, '#FFF6C8')
        star(d, 41, 13, 2.6, '#FFFFFF')
        star(d, 88, 52, 3.4, '#FFFFFF')
        star(d, 62, 12, 2.2, '#FFF6C8')
        for cx, cy, r in ((34, 32, 1.1), (17, 30, 1.3), (52, 20, 0.9),
                          (86, 70, 1.2), (93, 34, 1.0), (11, 60, 1.1),
                          (24, 74, 1.2)):
            circle(d, cx, cy, r, '#FFFFFF')
    else:
        # 眠りを表す三日月(太陽に見えないよう欠けさせる)＋うっすら雲
        punch_circle(img, 76, 24, 12, '#FFF1A8', 70, 20, 11)
        # 雲(左下の余白)。半透明だと円の重なりに継ぎ目が出るので不透明色で塗る。
        cloud = (226, 225, 246)
        circle(d, 11, 80, 4.5, cloud)
        circle(d, 17, 79, 6.5, cloud)
        circle(d, 24, 81, 4.5, cloud)
        d.rectangle(box(11, 80, 13, 5.5), fill=cloud)
        line(d, [(25, 25), (33, 25), (25, 35), (33, 35)], '#FFFFFF', 2)

    # ─ キャラ本体(共通) ─
    global _char
    _char = True
    d.polygon(P((55, 72), (84, 86), (82, 93), (52, 81)), fill='#3A3A3C')   # 尾
    for fx in (45, 55):
        line(d, [(fx, 82), (fx, 90)], '#FF9500', 2)
        line(d, [(fx - 3, 91), (fx, 90), (fx + 3, 91)], '#FF9500', 2)
    d.ellipse(box(21, 23, 58, 62), fill='#FFFFFF')                          # 体
    d.ellipse(box(61, 44, 18, 32), fill='#D8D8DC')                          # 翼

    if variant == 'sleep':
        quad(d, (39, 48), (42, 51), (45, 48), '#1C1C1E', 2)
        quad(d, (55, 48), (58, 51), (61, 48), '#1C1C1E', 2)
        d.polygon(P((47, 55), (53, 55), (50, 58)), fill='#FF9500')
    else:
        circle(d, 42, 48, 3, '#1C1C1E')
        circle(d, 58, 48, 3, '#1C1C1E')
        d.polygon(P((47, 54), (53, 54), (50, 60)), fill='#FF9500')

    circle(d, 36, 56, 3.5, (255, 150, 170, 115))                            # ほっぺ
    circle(d, 64, 56, 3.5, (255, 150, 170, 115))
    _char = False

    _scene = 1.0
    return img.convert('RGB').resize((size, size), Image.LANCZOS)


IOS_DIR = 'ios/BgRemover/Images.xcassets/AppIconSleep.appiconset'
IOS_SIZES = {
    'icon-20@1x.png': 20, 'icon-20@2x.png': 40, 'icon-20@3x.png': 60,
    'icon-29@1x.png': 29, 'icon-29@2x.png': 58, 'icon-29@3x.png': 87,
    'icon-40@1x.png': 40, 'icon-40@2x.png': 80, 'icon-40@3x.png': 120,
    'icon-50@1x.png': 50, 'icon-50@2x.png': 100,
    'icon-57@1x.png': 57, 'icon-57@2x.png': 114,
    'icon-60@2x.png': 120, 'icon-60@3x.png': 180,
    'icon-72@1x.png': 72, 'icon-72@2x.png': 144,
    'icon-76@1x.png': 76, 'icon-76@2x.png': 152,
    'icon-83.5@2x.png': 167, 'icon-1024@1x.png': 1024,
}
ANDROID_SIZES = {'ldpi': 36, 'mdpi': 48, 'hdpi': 72,
                 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# アダプティブアイコンのセーフゾーン(108dp 中 66dp)に収める縮小率
ADAPTIVE_SCENE = 0.66


def install(variant='day'):
    """通常アイコンとして variant を iOS/Android の既存アイコンに上書きする。"""
    master = draw(variant)                       # 1024 全面
    adaptive = draw(variant, scene=ADAPTIVE_SCENE)

    for name, px in IOS_SIZES.items():
        p = os.path.join(IOS_DIR, name)
        master.resize((px, px), Image.LANCZOS).save(p)
        print(p)

    for dpi, px in ANDROID_SIZES.items():
        legacy = f'android/app/src/main/res/mipmap-{dpi}/ic_launcher.png'
        fg = f'android/app/src/main/res/mipmap-{dpi}-v26/ic_foreground.png'
        master.resize((px, px), Image.LANCZOS).convert('RGBA').save(legacy)
        adaptive.resize((px, px), Image.LANCZOS).convert('RGBA').save(fg)
        print(legacy)
        print(fg)

    master.save('ios_app_icon_1024.png')
    adaptive.convert('RGBA').save('android_ic_launcher_foreground_1024.png')
    print('ios_app_icon_1024.png')
    print('android_ic_launcher_foreground_1024.png')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--install':
        install(args[1] if len(args) > 1 else 'day')
    else:
        outdir = args[0] if args else 'app_icons'
        os.makedirs(outdir, exist_ok=True)
        for v in ('day', 'night', 'sleep'):
            p = os.path.join(outdir, f'app_icon_{v}_1024.png')
            draw(v).save(p)
            print(p)
