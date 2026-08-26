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
NEEDS = ROOT / 'data' / 'article-images.json'

RAW = 'https://raw.githubusercontent.com/'
# 記事のページに残っている GitHub 直リンク
SRC_RE = re.compile(r'src="(https://raw\.githubusercontent\.com/[^"]+)"')

# 画面写真は横 1000px 前後。これ以上は読むのに要らない
MAX_W = 1280
QUALITY = 78
TIMEOUT = 30


def targets() -> dict[str, list[str]]:
    """どの記事の、どの画像を移すのかを決める。

    build-articles.mjs が書き出す data/article-images.json を使う。
    ここには「サブドメインから画像が読めなかった記事」と、その画像ぜんぶの
    元 URL が入っている。

    ⚠️ 以前はここで、書き出し済みのページから raw の URL を拾っていた。
       それだと、いちど控えに載った記事はページに raw が 1 つも出なくなるので、
       あとから足した画像も撮り直した画像も、二度と対象に入らない。
       2026-08-25 に qalc で、足した 2 枚が出ず、撮り直した 5 枚が古いまま
       残っているのが見つかった。
    """
    out: dict[str, list[str]] = {}

    # 1. build-articles.mjs が書き出した一覧
    if NEEDS.exists():
        data = json.loads(NEEDS.read_text(encoding='utf-8'))
        for slug, v in data.get('apps', {}).items():
            if v.get('images'):
                out.setdefault(slug, []).extend(v['images'])

    # 2. 書き出し済みのページに残っている raw の URL。
    #    一覧がまだ無いとき、一覧に載っていない記事があるときの補い。
    #    どちらか片方だけを見ると、その分だけ穴が空く。
    for page in sorted(APPS.glob('*/index.html')):
        slug = page.parent.name
        urls = SRC_RE.findall(page.read_text(encoding='utf-8'))
        if urls:
            out.setdefault(slug, []).extend(urls)

    return {slug: sorted(set(urls)) for slug, urls in sorted(out.items())}


def sources_path(slug: str) -> Path:
    """作ったときの元の大きさを控えておく場所。"""
    return OUT / slug / '.sources.json'


def load_sources(slug: str) -> dict:
    try:
        return json.loads(sources_path(slug).read_text(encoding='utf-8'))
    except Exception:                                # noqa: BLE001
        return {}


def remote_size(url: str) -> int | None:
    """元の大きさを HEAD で聞く。分からなければ None。"""
    req = urllib.request.Request(url, method='HEAD',
                                 headers={'User-Agent': 'giga-school-build'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            n = r.headers.get('Content-Length')
            return int(n) if n is not None else None
    except Exception:                                # noqa: BLE001
        return None


def is_stale(url: str, name: str, seen: dict) -> bool:
    """元が差しかわっていないか。控えの大きさと今の大きさを比べる。

    撮り直した画像は、名前が同じまま中身だけ変わる。ここを見ないと、
    古い写真がページに出たまま誰も気づかない。
    """
    was = seen.get(name, {}).get('bytes')
    if not isinstance(was, int):
        return True            # いつの控えか分からないものは、作り直して控えを取る
    now = remote_size(url)
    return now is not None and now != was


def local_name(url: str) -> str:
    """URL の最後のファイル名から、置き場所の名前を決める。

    ⚠️ ここは URL の見た目ではなくファイル名だけを使う。
       /HEAD/ を名前に含めると、ブランチ名が変わったときに
       同じ画像が別名で二重に置かれる。
    """
    return re.sub(r'\.[a-z0-9]+$', '.webp', url.rsplit('/', 1)[-1], flags=re.I)


def build(url: str, dst: Path) -> tuple[int, int]:
    """1 枚を取ってきて WebP にする。戻り値は（WebP のバイト数, 元のバイト数）。"""
    # Pillow は絵を作るときだけ要る。--check は入っていなくても通す
    try:
        from PIL import Image
    except ImportError:
        sys.exit('Pillow が要ります: pip install pillow')

    req = urllib.request.Request(url, headers={'User-Agent': 'giga-school-build'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
    src_bytes = len(raw)

    import io
    with Image.open(io.BytesIO(raw)) as im:
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.convert('RGB').save(dst, 'WEBP', quality=QUALITY, method=6)
    return dst.stat().st_size, src_bytes


def main() -> int:
    force = '--force' in sys.argv
    check = '--check' in sys.argv

    if not APPS.exists():
        sys.exit(f'{APPS} がありません。先に tools/build-articles.mjs を走らせてください')

    todo = targets()
    made = kept = total = 0
    missing: list[str] = []
    stale: list[str] = []

    for slug, urls in todo.items():
        seen = load_sources(slug)
        changed = False
        for url in urls:
            name = local_name(url)
            dst = OUT / slug / name
            if dst.exists() and not force:
                # 名前が同じまま中身が差しかわっていないかを見る
                if not is_stale(url, name, seen):
                    kept += 1
                    total += dst.stat().st_size
                    continue
                if check:
                    stale.append(f'{slug}/{name}')
                    continue
            elif not dst.exists() and check:
                missing.append(f'{slug}/{name}')
                continue
            elif check:
                continue                       # --force と --check を同時に渡したとき
            try:
                size, src_bytes = build(url, dst)
                total += size
                made += 1
                seen[name] = {'url': url, 'bytes': src_bytes}
                changed = True
            except Exception as e:                       # noqa: BLE001
                print(f'⚠️ 取れなかった {url}: {e}')
        if changed:
            sources_path(slug).write_text(
                json.dumps(seen, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                encoding='utf-8')

    if check:
        if missing or stale:
            if missing:
                print(f'❌ 自分のドメインに無い画面写真が {len(missing)} 枚あります')
                print(f'   例: {", ".join(missing[:5])}')
            if stale:
                print(f'❌ 元が差しかわった画面写真が {len(stale)} 枚あります')
                print(f'   例: {", ".join(stale[:5])}')
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
