#!/usr/bin/env python3
"""記事の画面写真のうち、GitHub からしか読めないものを自分のドメインに移す。

  python3 tools/build-article-images.py          足りないものだけ作る
  python3 tools/build-article-images.py --force  作り直す
  python3 tools/build-article-images.py --check  足りていないものがあるかだけ見る

  ※ tools/build-articles.mjs のあとに走らせる（どの記事が GitHub から
     読んでいるかを、書き出されたページから見分けるため）

必要なもの: Pillow（pip install pillow）。build-og.py と同じで、
絵を作るときだけ要る。--check は入っていなくても通る。

── なぜ要るのか ────────────────────────────────

記事の画像 810 枚のうち **234 枚（29%）が raw.githubusercontent.com** から
読まれている。11 本の記事で、1 本あたり約 21 枚。

残る 20 本は自分のサブドメインから出ていて問題ない。
docs/ を配っていない Vite のアプリだけがこうなっている。

危ないところが 2 つある。

  1. 記事の 29 本が「校内のフィルタリングで許可を」と書いているとおり、
     学校は外部ドメインを塞ぐ。GitHub が塞がれている学校では、
     その 11 本は画面写真が 21 枚まとめて出ない。
     説明が絵で成り立っている記事なので、読めなくなる。

  2. 468 か所すべてが /HEAD/（ブランチの先頭）を指していて、
     コミットで固定されているものは 0 件。画像の名前を変えたり
     フォルダを整理した瞬間、過去の記事の画像が黙って消える。

── なぜ全部ではなく 234 枚なのか ──────────────────

31 本ぶんを全部取り込むと 717 枚・約 170MB になる。これは重すぎるので、
build-articles.mjs のコメントにあるとおり見送られている。

ここで移すのは**サブドメインから読めない 11 本ぶんだけ**。
うまく読めている 20 本には触らない。WebP にして約 9MB で収まる。
（1 枚あたり約 39KB。実測した）

── どこに置くか ────────────────────────────────

assets/article/<slug>/<元のファイル名>.webp

assets/thumbs/ と同じ考え方で、自分のドメインから配る。
build-articles.mjs は、ここにファイルがあればそちらを指し、
無ければこれまでどおり raw.githubusercontent.com に落ちる。
**この道具を走らせなくても記事は壊れない。**
"""

import json
import re
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
APPS = ROOT / 'apps'
OUT = ROOT / 'assets' / 'article'
DATA = ROOT / 'data' / 'apps.json'

RAW = 'https://raw.githubusercontent.com/'
# 記事のページに残っている GitHub 直リンク
SRC_RE = re.compile(r'src="(https://raw\.githubusercontent\.com/[^"]+)"')

# 画面写真は横 1000px 前後。これ以上は読むのに要らない
MAX_W = 1280
QUALITY = 78
TIMEOUT = 30


def targets() -> dict[str, list[str]]:
    """書き出し済みのページから、GitHub を指している画像を拾う。"""
    out: dict[str, list[str]] = {}
    for page in sorted(APPS.glob('*/index.html')):
        slug = page.parent.name
        urls = sorted(set(SRC_RE.findall(page.read_text(encoding='utf-8'))))
        if urls:
            out[slug] = urls
    return out


def local_name(url: str) -> str:
    """URL の最後のファイル名から、置き場所の名前を決める。

    ⚠️ ここは URL の見た目ではなくファイル名だけを使う。
       /HEAD/ を名前に含めると、ブランチ名が変わったときに
       同じ画像が別名で二重に置かれる。
    """
    return re.sub(r'\.[a-z0-9]+$', '.webp', url.rsplit('/', 1)[-1], flags=re.I)


def build(url: str, dst: Path) -> int:
    """1 枚を取ってきて WebP にする。戻り値はバイト数。"""
    # Pillow は絵を作るときだけ要る。--check は入っていなくても通す
    try:
        from PIL import Image
    except ImportError:
        sys.exit('Pillow が要ります: pip install pillow')

    req = urllib.request.Request(url, headers={'User-Agent': 'giga-school-build'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()

    import io
    with Image.open(io.BytesIO(raw)) as im:
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.convert('RGB').save(dst, 'WEBP', quality=QUALITY, method=6)
    return dst.stat().st_size


def main() -> int:
    force = '--force' in sys.argv
    check = '--check' in sys.argv

    if not APPS.exists():
        sys.exit(f'{APPS} がありません。先に tools/build-articles.mjs を走らせてください')

    todo = targets()
    made = kept = total = 0
    missing: list[str] = []

    for slug, urls in todo.items():
        for url in urls:
            dst = OUT / slug / local_name(url)
            if dst.exists() and not force:
                kept += 1
                total += dst.stat().st_size
                continue
            if check:
                missing.append(f'{slug}/{local_name(url)}')
                continue
            try:
                total += build(url, dst)
                made += 1
            except Exception as e:                       # noqa: BLE001
                print(f'⚠️ 取れなかった {url}: {e}')

    if check:
        if missing:
            print(f'❌ 自分のドメインに無い画面写真が {len(missing)} 枚あります')
            print(f'   例: {", ".join(missing[:5])}')
            print('   python3 tools/build-article-images.py で作れます')
            return 1
        print(f'✅ 記事の画面写真はそろっています（{kept} 枚）')
        return 0

    n_articles = len(todo)
    print(f'記事の画面写真：新しく {made} 枚 / そのまま {kept} 枚'
          f'（{n_articles} 本ぶん、合わせて {total / 1024 / 1024:.1f}MB）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
