# standards/ — GIGA school アプリ群の共通コードの正本

ここは、複数のリポジトリで同じ役割を持つファイルの**正本（コピー元）**を置く場所です。
各アプリは「外部依存なし・自己完結」で配信するため、ここを実行時に読み込むことは**しません**。
正本を各リポジトリへ**コピーして**使い、ずれ（ドリフト）は CI で検知します。

## なぜ要るのか

これまで同じ役割のファイル（品質ゲート・Service Worker の版管理・学習ログの受け渡し口）が
リポジトリごとにコピーされ、別々に進化していました。その結果、

- あるリポジトリで直したバグが、他のコピーには届かない
- 「リリースごとに版を上げる」という人手の手順が、全リポジトリで同時に抜ける

という事故が実際に起きています。正本を1か所に決め、コピーのずれを機械で見張ります。

## 置いてあるもの

| パス | 役割 | 由来（最初の正本に昇格した実装） |
|---|---|---|
| `check-drift.mjs` | 各リポジトリの CI から呼ぶ、正本とのずれ検知 | 新規 |
| `sw/build-sw-vite.mjs` | Vite 系アプリの SW 版数・先読み一覧をビルド成果物の中身から自動生成 | digitalcloset `tools/build-sw.mjs` |
| `sw/build-sw-static.mjs` | 生成物をコミットするアプリの SW 版数を、先読み対象の中身から自動生成（`--check` で CI 照合） | xxx_automatic `scripts/build-sw.mjs` |
| `records/records-export.js` | 学習ログ(study.v1)の読み取り専用受け渡し口（iframe + postMessage） | qalc `public/records-export.js` |
| `records/records-export.html` | 受け渡し口のページ（人が開いたとき用の説明） | qalc + viewport-fit 修正 |
| `records/records-export.test.mjs` | 受け渡し口の検査（通してはいけない相手を厚く並べる） | kake_master `tests/records-export.test.mjs` |
| `records/records-hub-client.js` | 学習ログを記録ハブへ写すクライアント（第2世代） | gamification `records-hub-client.js` |
| `docs/gas-redeploy.md` | GAS アプリの再デプロイ手順・対象一覧 | 新規 |

## 使い方（アプリ側リポジトリ）

1. 必要なファイルをこのディレクトリからコピーする。
   `records-export.js` の `APP_ID` のような**アプリ固有の1行だけ**書き換えてよい。
2. リポジトリ直下に `standards-map.json` を置く:

   ```json
   {
     "files": [
       { "canonical": "records/records-export.js", "local": "public/records-export.js", "normalize": ["app-id"] },
       { "canonical": "sw/build-sw-static.mjs",    "local": "tools/build-sw.mjs" }
     ]
   }
   ```

3. CI にずれ検知のジョブを足す（GIGAyama.github.io を checkout して照合する。実行時依存は増えない）:

   ```yaml
   drift:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/checkout@v4
         with: { repository: GIGAyama/GIGAyama.github.io, path: .standards-src }
       - run: node .standards-src/standards/check-drift.mjs --standards .standards-src/standards
   ```

## 正本を直したいとき

1. **先にここ（正本）を直す。** 個別リポジトリのコピーを先に直すと、ドリフト検知が赤になって知らせる。
2. 直した正本を、`standards-map.json` を持つ全リポジトリへコピーして PR を出す。

`normalize` に書ける値（照合前に両側へ適用される）:

- `app-id` — `APP_ID = '...'` / `appId: '...'` の値をプレースホルダーに置換（アプリ固有IDの1行を許す）
- `records-export-import` — テストの import 先パスを置換（`js/` と `public/` の置き場の違いを許す）
