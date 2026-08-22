# 品質ゲートのフォーク9本 — 実測と、どうするか

`scripts/lib/giga-v5-checks.mjs` は正本（`standards/lib/`）と同じ場所・同じ名前で
置かれているのに、**中身が別物**のリポジトリが9本ある。
2026-08-22 に実測した結果と、扱いの判断をここに残す。

`check-drift.mjs` はこれらを「未登録」として毎回報告する（GIGAyama.github.io#34）。
**あえて黙らせていない。** `unmanaged` に書けば警告は消せるが、消すと
「移行がまだ」という事実まで見えなくなる。下の表がその警告への答えである。

## 実測

正本は 965 行・38 検査。フォークは 275〜584 行で、**検査IDの体系からして違う**
（正本 `A_LICENSE` に対し quarto / mirai-compass は `A1_LICENSE`）。
`quality.config.json` の書式も違う（quarto は `appVersion` / `swSource` /
`knownDeviations` という別世代）。**コピーし直せば済む話ではない。**

### いちばん効く違い: SW の版ずれを検出できるか

手書きの版は 2026-08-21 に12リポジトリで同時に上げ忘れる事故を起こした。
「配信物を1バイト変えて `npm run check` を回す」実験で確かめた結果:

| リポジトリ | 行数 | 版ずれの検出 | 備考 |
|---|---|---|---|
| digitalcloset | 304 | **する** | 正本と同じ `__APP_VERSION__` 方式 |
| quoridor | 360 | **する** | 同上 |
| reversi | 331 | **する** | 同上 |
| xxx_automatic | 311 | **する** | 独自の `SW_VERSION_STALE`。目印の書き方が違うだけで働いている |
| **quarto** | 449 | **しない** | `src/sw.js` は手書き `const APP_VERSION = 'v4'` |
| **mirai-compass** | 584 | **しない** | `docs/sw.js` は手書き `'v3'` |
| **online-100square-calculation** | 424 | **しない** | `src/sw.js` は手書き `'v1.7.1'` |
| **schoolplan_editor** | 373 | **しない** | `docs/sw.js` |
| app_launcher | 275 | ― | **Chrome 拡張**。sw.js を持たない |

## 判断

### app_launcher — 移行しない

PWA ではなく Chrome 拡張（`background.js` / `content.js` / `popup.html` /
`manifest.json`）。PWA 向けの検査を当てるのは誤り。275 行のゲートはこの
リポジトリに合っている。**フォークではなく、種類が違う。**

### digitalcloset / quoridor / reversi / xxx_automatic — 急がない

いちばん効く「版ずれの検出」は働いている。正本へ寄せる値打ちはあるが、
いま困っていることは無い。ほかの作業のついでに、で構わない。

### quarto / mirai-compass / online-100square-calculation / schoolplan_editor — ここから

**配信物を変えても版が据え置きのまま緑になる。** 直した画面が端末に届かず、
以降の修正すべてが「直したはずなのに直らない」に見える。切り分けに何日も溶ける形。

移行は2段に分けられる。

1. **先に、版ずれの検出だけ入れる**（小さい・すぐ効く）
   `standards/sw/build-sw-static.mjs` か `build-sw-vite.mjs` を配り、
   `sw.js` の版行に目印を付け、`npm run check` に照合を足す。
   ゲート本体には触らない。
2. **あとで、ゲートを正本へ寄せる**（大きい）
   検査IDの体系と `quality.config.json` の書式が変わるので、
   設定の作り直しと全項目の再確認が要る。1本ずつ。

**1 だけ先にやれば、いちばん高い危険は消える。** 2 は急がない。

## schoolplan_editor はもう1件ある

`scripts/gas-deploy.mjs` が **182 行**、正本は **317 行**（135 行の遅れ）。
本番の GAS へ push するスクリプトで、正本にある

- 送ると GAS から消えるファイルの確認
- `appsscript.json` の欠落の確認
- デプロイが複数のときの対応

がどれも入っていない世代である。ゲートの移行とは別に、こちらを先に揃えるほうが
効く（`standards-map.json` に登録してコピーするだけで済む）。
