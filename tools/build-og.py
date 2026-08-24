#!/usr/bin/env python3
"""共有されたときに出る絵（og:image）を、カードのサムネイルから作る。

  python3 tools/build-og.py          足りないものだけ作る
  python3 tools/build-og.py --force  作り直す
  python3 tools/build-og.py --check  足りていないものがあるかだけ見る

  ※ tools/build-articles.mjs のあとに走らせる（どの記事が足りていないかを、
     書き出されたページの og:image から見分けるため）

必要なもの: Pillow（pip install pillow）。**この 1 本だけが Pillow を使う。**
しかも絵を作るときだけで、--check は入っていなくても通る。
サイトの組み立て（tools/*.mjs）は依存なしのままで、これを走らせなくても壊れない。

── なぜ要るのか ────────────────────────────────

紹介ページの og:image は、記事の 1 枚目の画面写真を使っている。
ただし自分のドメインから出せるものに限る（SNS のクローラは
raw.githubusercontent.com を取りに行けないことがあり、
ブランチの先頭を指すので壊れやすくもある）。

Vite で dist/ だけを配っているアプリは、記事の画像がサブドメインから読めない。
そのため 31 本のうち 11 本が、中身と関係のない共通の絵で共有されていた。
X や LINE に貼られたとき、3 本に 1 本が「どのアプリの話か分からないカード」になる。

── なぜサムネイルから作るのか ──────────────────────

assets/thumbs/<slug>-1.webp は、そのアプリの画面を作者が選んだもので、
すでに自分のドメインにある。材料はもう手元にあった。

足りなかったのは形式だけ。WebP はクローラが読めないことがあるので
（似顔絵の og-profile.jpg を JPEG にしてあるのと同じ理由）、JPEG に変える。

── 足りていない記事にだけ作る理由 ──────────────────

サムネイルは記事の 1 枚目とは限らず、途中の画面のこともある
（「ハンデ設定（カベの枚数）」のような）。それでも、サイト共通の絵よりは
「そのアプリの実際の画面」のほうが手がかりになる。

一方、いま記事の画面写真が使えている 20 本まで差し替えると、
うまくいっているものを、より弱い絵に変えることになる。
だから**共通の絵に落ちている記事にだけ**作る。

── 文字を焼き込まない理由 ────────────────────────

アプリ名を絵の中に入れると見栄えはよくなるが、日本語のフォントが要る。
どのフォントが入っているかは環境によって違うので、作った人によって
出来上がりが変わる。題と説明は og:title / og:description で渡るので、
絵は画面写真だけにしてある。
"""

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
THUMBS = ROOT / 'assets' / 'thumbs'
APPS = ROOT / 'apps'
OUT = ROOT / 'assets' / 'og'

# 「この記事は記事の画面写真を使えていない」の目印。
# ⚠️ 2 つ見る。作ったあとは og:image が assets/og/<slug>.jpg に変わるので、
#    共通の絵だけを目印にすると、次からは対象から外れてしまう。
#    そうなると --check が素通りし、--force も何も作り直さなくなる。
GENERIC = 'og:image" content="https://giga-school.com/assets/og.png"'
MADE = 'og:image" content="https://giga-school.com/assets/og/'

# SNS のカードの大きさ。og:image:width / height にも同じ数を書いている
SIZE = (1200, 630)
PAD = 40
# 地の色。style.css の --brand（#0f4a94）と同じ
BG = (15, 74, 148)
QUALITY = 82


def build(src: Path, dst: Path) -> int:
    """サムネイル 1 枚を 1200×630 の JPEG にする。戻り値はバイト数。"""
    # Pillow は絵を作るときだけ要る。--check は入っていなくても通す
    # （CI では足りているかを見るだけで、作りはしない）
    try:
        from PIL import Image
    except ImportError:
        sys.exit('Pillow が要ります: pip install pillow')

    with Image.open(src) as im:
        im = im.convert('RGB')
        # 縦横比が違う（サムネイルは 16:10、カードは約 1.9:1）ので、
        # 切らずに収める。切ると画面の端の説明が消えることがある
        box = (SIZE[0] - PAD * 2, SIZE[1] - PAD * 2)
        scale = min(box[0] / im.width, box[1] / im.height)
        shot = im.resize((round(im.width * scale), round(im.height * scale)),
                         Image.LANCZOS)
        card = Image.new('RGB', SIZE, BG)
        card.paste(shot, ((SIZE[0] - shot.width) // 2, (SIZE[1] - shot.height) // 2))
        dst.parent.mkdir(parents=True, exist_ok=True)
        card.save(dst, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    return dst.stat().st_size


def needed() -> list[str]:
    """共通の絵に落ちている記事の slug。書き出し済みのページから見分ける。"""
    out = []
    for page in sorted(APPS.glob('*/index.html')):
        slug = page.parent.name
        html = page.read_text(encoding='utf-8')
        if GENERIC in html or f'{MADE}{slug}.jpg"' in html:
            out.append(slug)
    return out


def main() -> int:
    force = '--force' in sys.argv
    check = '--check' in sys.argv

    if not APPS.exists():
        sys.exit(f'{APPS} がありません。先に tools/build-articles.mjs を走らせてください')

    made, kept, missing, total = 0, 0, [], 0
    for slug in needed():
        src = THUMBS / f'{slug}-1.webp'
        dst = OUT / f'{slug}.jpg'
        if not src.exists():
            missing.append(f'{slug}（サムネイルがありません）')
            continue
        if dst.exists() and not force:
            kept += 1
            total += dst.stat().st_size
            continue
        if check:
            missing.append(slug)
            continue
        total += build(src, dst)
        made += 1

    if check:
        if missing:
            print(f'❌ 共有の絵が足りません（{len(missing)} 本）: {", ".join(missing)}')
            print('   python3 tools/build-og.py で作れます')
            return 1
        print(f'✅ 共有の絵はそろっています（{kept} 本）')
        return 0

    if missing:
        print(f'⚠️ サムネイルが無くて作れなかったもの: {", ".join(missing)}')
    print(f'共有の絵：新しく {made} 本 / そのまま {kept} 本 / 合わせて {total / 1024:.0f}KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
