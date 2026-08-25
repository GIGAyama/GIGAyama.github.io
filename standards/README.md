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
| `skills/devlog-article/` | 開発記録（`/devlog/`）を書くスキル | 新規 |
| `skills/note-article/` | note の紹介記事を書くスキル | 書き手の手元の版（下記）|

### note-article の正本をどこから取ったか

`Ice_slide-puzzle/.claude/skills/note-article/` に手で置かれたものがありますが、
**そちらは古い版でした。** 正本にしたのは書き手の手元にある版です。

| ファイル | 正本 | Ice_slide-puzzle |
|---|---|---|
| `SKILL.md` | 20,486 | 8,459 |
| `references/style.md` | 14,125 | 7,012 |
| `references/screenshots.md` | 11,980 | 6,819 |
| `references/interview.md` | 10,690 | 無し |
| `scripts/lint-article.mjs` | 24,580 | 無し |
| `scripts/capture.mjs` | 22,086 | 11,622 |
| `scripts/serve.mjs` | 3,862 | 2,722 |
| `scripts/peer-server.mjs` | 2,375 | 2,375（同じ）|

`SKILL.md` には「書いた記事がどこへ行くか」「途中から始めるとき」の 2 節が
まるごと足りず、体裁の検査（`lint-article.mjs`）そのものがありませんでした。

⚠️ **リポジトリに置いてあるほうを正本にしてはいけない。** 古い版を 42 本へ配って
しまいます。`Ice_slide-puzzle` は配布のときに新しい版で上書きされます。

### `node --test` を素で回すと 1 本落ちる（正常）

`standards/records/records-export.test.mjs` は**配布先で走らせる正本**です。
配布先では `tests/records-export.test.mjs` に置かれ、その隣の `js/` か `public/` から
受け渡し口を読みます（`normalize: records-export-import` が置き場の違いを吸収する）。

ポータルには `standards/js/` が無いので、リポジトリの直下で `node --test` を
素で回すと、この 1 本だけが必ず落ちます。

⚠️ **import を書き替えて直さないこと。** 書き替えると配布先 9 本の `normalize` と
食いちがい、ずれ検知が本物のずれを見のがすようになります。
ポータルの CI（`standards-ci.yml`）はこの正本を `node --check`（構文が読めるか）
だけ通していて、実行はしていません。

### `check-drift.mjs` は配らない

これだけは各リポジトリへ**写しません**。CI が GIGAyama.github.io を checkout して
`.standards-src/standards/check-drift.mjs` を直に走らせます（上の 3 の書き方）。
実際、対応表に載せているリポジトリは 0 本です（2026-08-25 に実測）。

そのため、この検知そのものを直したときは**配る作業が要りません。**
ポータルの `main` に入った時点で、全リポジトリの次の CI から効きます。

## 使い方（アプリ側リポジトリ）

1. 必要なファイルをこのディレクトリからコピーする。
   `records-export.js` の `APP_ID` のような**アプリ固有の1行だけ**書き換えてよい。
2. リポジトリ直下に `standards-map.json` を置く:

   ```json
   {
     "files": [
       { "canonical": "records/records-export.js", "local": "public/records-export.js", "normalize": ["app-id"] },
       { "canonical": "sw/build-sw-static.mjs",    "local": "tools/build-sw.mjs" }
     ],
     "dirs": [
       { "canonical": "skills/devlog-article", "local": ".claude/skills/devlog-article" },
       { "canonical": "skills/note-article",   "local": ".claude/skills/note-article" }
     ]
   }
   ```

   `files` は 1 ファイルずつ。`dirs` はディレクトリまるごと。

   スキル（`.claude/skills/`）は中身が増えたり減ったりするので `dirs` を使う。
   `dirs` は両方向に見るので、**正本にファイルを 1 本足した瞬間に配布先が赤くなる。**
   `files` で並べる方式だと、対応表を直し忘れたぶんが黙って配られない。

   ⚠️ `dirs` に `normalize` は無い。スキルにアプリ固有の1行は無いので、
   ずらしてよい場所を作らない。要るようになったら `files` に並べ直すこと。

   詳しくは `skills/README.md`。スキルの配る先はコードの正本と違う（42 本 対 32 本）。

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

### 配り忘れは機械が見張る

2 を人が覚えている前提にしていたところ、2026-08-22 に正本のゲートを3回直して
配るのを忘れ、10本のリポジトリの main が同時に赤くなりました。各リポジトリの
ずれ検知はそのリポジトリに push があったときしか走らないので、正本だけを直した
日は誰も気づけません。

そこで、ポータル側から逆向きに見る検査を置いています。

```
node tools/check-distribution.mjs            # 配布先ぜんぶと突き合わせる
node tools/check-distribution.mjs --skip-repo-list   # 手元で試すとき（台帳の抜けは見ない）
```

配布先は `tools/distribution.json`（台帳）に GitHub 上の名前（`Typa` のように大文字小文字ごと）で書きます。照合は大文字小文字を区別しません。

台帳は軸を 2 つ持ちます。`targets` はコードの正本を配る先（32 本）、
`skills.extra` はコードは配らないがスキルは配る先（10 本）。
`excluded` の理由はどれも「正本のコピーを1つも持たない」で、これはコードの話です。
開発はどのリポジトリでも起きるので、スキルは 42 本すべてに配ります。
ここは各リポジトリへ配るものではないので、正本の外（`tools/`）に置いています。GIGAyama にあるリポジトリは
`targets`（配る先）か `excluded`（配らない・**理由つき**）のどちらかに必ず載せます。
どちらにも無いリポジトリが現れたら赤くします。

この検査は `.github/workflows/check-distribution.yml` から、main への push と毎朝
走ります。**pull_request では走らせません** — 配布先のずれ検知はポータルの main を
見るので、正本が main に入るまで配る PR は作れないためです。正本を直してから
最後の1本を配り終えるまで main は赤く、それがやり残しの一覧になります。

`normalize` に書ける値（照合前に両側へ適用される）:

- `app-id` — `APP_ID = '...'` / `appId: '...'` の値をプレースホルダーに置換（アプリ固有IDの1行を許す）
- `records-export-import` — テストの import 先パスを置換（`js/` と `public/` の置き場の違いを許す）
