# GIGA 各アプリの練度を上げる作業 — Claude Code への指示

あなたは小学校教員 GIGAyama が 1 人で保守している 43 リポジトリ（`/home/user/` 以下）を触ります。利用者は小学生と教員、教室で 40 台が一斉に使います。**この現場で実際に起きているのは「直したつもりで壊れる」「緑なのに届いていない」です。** 以下は実測に基づく規律です。

---

## 0. 最初に必ずやること（この順で、飛ばさない）

### 0-0. この環境でできないことを先に知る

実測（2026-08-22）で確認済みの制約です。**できないものを「確認しました」と書かないこと。**

| やりたいこと | 実際 | 代わりにやること |
|---|---|---|
| `gh run list` で CI を見る | **`gh` は入っていない**（`command -v gh` が exit 1） | `mcp__github__actions_list`（`owner: GIGAyama`, `repo: <ディレクトリ名のまま>`）。API は大小を区別しないので綴りは気にしなくてよい |
| `npm run check:bridges` | **外部通信が塞がれている**（`curl https://typa.giga-school.com/…` → `CONNECT tunnel failed, 403`）。`gamification/tools/check-bridges.mjs:20` 自身が「本番サイトへの通信を伴う」と書いている | 手元で目視 5 点（§4）を確認し、PR 本文に「**本番疎通は未確認**」と明記する |
| ブラウザで実測 | `~/.cache/ms-playwright` は無い。`node_modules` があるのは 43 本中 **11 本**（haiku-meeting / homework_barcordreader / kana_master / kanji_town / keisan-card / online-100square-calculation / omp-lite / qalc / quoridor / reflection_journal / reversi） | **「未計測」と書く**。`typa/AUDIT.md:10-12`「『未計測』は ✅ では ありません」に従う。確認手段が無いのに見た目を変えない |

### 0-1. 作業の範囲を先に宣言する（ここを飛ばすと全部が膨らむ）

**1 リポジトリ・1 PR・1 目的。ついでの整理を混ぜない。**（OGP 一括投入のついでに検査が赤くなり main が落ちた werewolf の事故が実例。）

「触ったら〜も同じ PR で」は 2 段に分けます。

- **必須（同じ PR に入れる）**
  - 配信物を変えたら **SW の版**（§2-1）。12 本同時の上げ忘れという実害が出ているのはここだけ
  - `appId` を変えたら **4 か所すべて**（§4）
  - `.gs` の公開関数を新設したら **認可**（§5-1）
- **任意（今回やらないなら、PR 本文に「次の入口」として理由つきで書けばよい）**
  - 正本コピーへの移行、self-test の新設、手書き SW の自動採番化、CI へのジョブ追加、テストの新設

**着手前に、そのリポジトリで「人が見送った決定」を確認する。**

```bash
grep -rn "見送\|入れない判断\|持ちません" AUDIT.md README.md quality.config.json 2>/dev/null
```

日付つきの人間の判断がある項目には勝手に着手しないこと。実例:
- `music-production_studio/AUDIT.md:149` … 「人間の判断（2026-08-03）により、**P1（CSP・自己ホスト化）と品質ゲートは見送る**」
- `qalc/AUDIT.md:347` … 自動再接続は「入れない判断」
- `townmap_mikke/AUDIT.md:285` … 「誤った CSP は全児童のログインを止めるため、投入は見送った」
- `keisan-block/README.md:359` … 印刷用スタイルは持たない（理由つき）

**判断に迷ったら勝手に決めない。** とくに「外部から実行コードを取る例外を残すか」「学習記録の設計変更」「AI が児童へ直接届く経路」は必ず先に GIGAyama さんに確認する。

### 0-2. 現在地を取り、ブランチを作り直す

```bash
cd /home/user/<repo>
git fetch origin
DEF=$(git symbolic-ref --short refs/remotes/origin/HEAD)   # sekigaemaker だけ origin/master
git log --oneline $DEF..HEAD      # 手元にある「まだ入っていない」コミット
git diff HEAD $DEF --stat
git switch -C claude/<この作業だけの名前>-$(date +%m%d) $DEF
```

- **fetch する前の `origin/main` を根拠に何も判断しない。** fetch 前は haiku-meeting が「508 行未マージ」に見え、fetch 後は差分ゼロだった。誤読のまま作業すると、すでに本番に入っている 508 行を二重に作り直す。
- **いま手元にあるブランチをそのまま使わない。** 実測で **43 本中 39 本**が同じ名前 `claude/giga-secret-link-replace-3n3y0b` の「ゾンビブランチ」の上に立っています（main のままは gobblet / jidosha_zukan / tsubomi-learning、master は sekigaemaker）。中身は既にマージ済みなのに、squash 前の古いコミットを抱えています。
  - **壊れ方:** その上に積んで push すると、PR の差分に「すでに main に入っている変更」が再び現れる。main 側が後からその行を触っていると mergeable_state が dirty になり、`pull_request` トリガの CI が**失敗ではなく「1 件もスケジュールされない」**。緑でも赤でもない PR は見落としてマージされる。
- ブランチ名は 1 PR に 1 つ（Keisan-Card #26〜#31 は 6 連続で同じ名前を使い回していた）。
- **push する直前にもう一度** `git fetch origin && git log --oneline HEAD..$DEF` が空であることを確認する。空でなければ rebase。force push は使わない。ポータル（GIGAyama.github.io）は毎朝 6:17 JST に bot が index.html / data/apps.json / sitemap.xml / apps/ を main へ直接コミットするので、一晩置いたブランチは必ず衝突します。**ローカルは現在 13 コミット遅れで、その中に `revert:` が含まれます。遅れたまま押し込むと取り下げたはずの変更が復活します。**

### 0-3. そのリポジトリが何で守られているかを「読む」（推測しない）

```bash
node -e "console.log(Object.keys(require('./package.json').scripts||{}).join(' '))" 2>/dev/null || echo "package.json 無し"
ls .github/workflows/ 2>/dev/null
grep -l pull_request .github/workflows/*.yml 2>/dev/null || echo "★PR ではゲートが回らない"
grep -rn "self-test\|verify-gate\|gate:self" .github/workflows/ package.json 2>/dev/null
ls standards-map.json quality.config.json sw-build.config.json 2>/dev/null
```

- **スクリプト名はリポジトリごとに違う。** self-test は `check:self-test`(typa, kake_master) / `check:self`(quarto) / `verify-gate`(reversi, digitalcloset) / `gate:selftest`(app_launcher) / `gate:self-test`(quoridor)。さらに haiku-meeting / kana_master / mirai-compass / online-100square は **package.json に script が無く、ci.yml が直接 `node …/check-project.mjs --self-test` を呼んで**います。**名前を推測せず、package.json と ci.yml の両方を読むこと。** typa（`check:self-test`）と quarto（`check:self`）は持っているのに CI に入っていません。
- `pull_request` トリガのワークフローが 1 本も無いのは 8 本（blackboard_timer / jidosha_zukan / shared-folder-sync / tsubomi-learning / music-production_studio / notebooksample_generator / werewolf / word_basket）。ここは push 前に手元で全部走らせ、結果を PR 本文に貼ること。
- **触る前に直近 run を見る。** `mcp__github__actions_list`（`list_workflow_runs`）。**werewolf は現在デプロイが赤で止まっています**（直近 2 run が failure。2026-08-21 の OGP 一括投入で自前 F7 検査が自ドメインを外部オリジンと誤検知。deploy.yml が `push:main` のみなので PR は緑のまま main で落ちた）。直近 2 コミットは教室に届いていません。

### 0-4. 反映経路を確定する（**4 経路あります**）

```bash
ls manifest.json netlify.toml CNAME .clasp.json 2>/dev/null
```

| 目印 | 経路 | 「main にマージ」で届くか |
|---|---|---|
| `CNAME` | GitHub Pages | 届く（ただし §11 の paths 条件に注意） |
| `.clasp.json` | GAS 自動デプロイ | 届く場合と**届かない場合がある**（§5-4） |
| `manifest.json`（拡張） | Chrome ウェブストア審査 or 管理コンソール配布 | **届かない** |
| `netlify.toml` | Netlify（sekigaemaker のみ） | 別経路 |

- Chrome 拡張は 3 本（`app_launcher` MV3 v3.1 / `blackboard_timer` v2.0 / `linker-clipper` v1.0）。**`manifest.json` の `version` を上げない限り、直しても 1 台にも配られません。** 触ったら同じ PR で version を上げること。
- `linker-clipper` は **1 リポジトリに 3 経路が同居**（manifest.json + CNAME/index.html + Code.gs/Gemini.gs）。「このリポジトリの反映経路」が単数である前提が崩れます。
- **壊れ方:** 拡張のバグを直して main にマージし「直しました」と報告する。ストアに出していないので教室の端末は何週間も古いまま。先生は「直したと言われたのに直っていない」と受け取る。
- 拡張には規律がほぼありません（`blackboard_timer` は `.github/` も `package.json` も `quality.config.json` も無い）。`linker-clipper/manifest.json` は icons が `icon.svg` ですが **Chrome は拡張アイコンに SVG を描画しません**（ツールバーは既定の絵のまま）。触るなら PNG に。

### 0-5. 正本コピーの状態を確かめる

```bash
md5sum scripts/lib/giga-v5-checks.mjs 2>/dev/null   # 正本は 2e12fd02… / 934 行
node /home/user/GIGAyama.github.io/standards/check-drift.mjs --standards /home/user/GIGAyama.github.io/standards
```

- **正本と一致しているのは 9 本だけ**（ice_slide-puzzle, kake_master, kana_master, keisan-block, keisan-card, omp-lite, reading-books, shiritori_fighter, typa）。残り 9 本は**同じパスに置かれた別物**です: app_launcher 275 行 / digitalcloset 304 / xxx_automatic 311 / reversi 331 / quoridor 360 / schoolplan_editor 373 / online-100square 424 / quarto 449 / mirai-compass 584。
  - これらでは `E_SW_VERSION_GENERATED` も `E_OFFLINE_HTML` も `E_SW_PRECACHE_OFFLINE` も**存在しません**。`cd /home/user/quarto && npm run check` は「29/29 満たした」と緑になりますが、`src/sw.js:17` は手書きの `const APP_VERSION = 'v4';` のまま。**「ゲートを通ったから大丈夫」という判断そのものが嘘になります。**
- **フォークのリポジトリでは検査ロジックに触らないこと**（アプリのコードは直してよい）。正本への移行は「コピーして map に 1 行足す」作業ではありません — quarto の `quality.config.json` は `appVersion / swSource / knownDeviations` という別世代のスキーマで、載せ替えると設定の作り直し＋全項目の再確認になります。検査を直す必要が出たらそこで手を止め、「正本移行を先にやるか」を GIGAyama さんに聞くこと。
- **`check-drift.mjs` は cwd 依存です（`check-drift.mjs:39` が `path.resolve('standards-map.json')`）。必ず対象リポジトリ直下で実行し、`✅ 正本と一致しています（N ファイル）` **以外は緑と数えないこと**。実測:

```
$ cd /home/user/digitalcloset && node …/check-drift.mjs --standards …
[drift] standards-map.json が無いので照合するものがありません（このリポジトリは正本コピーを持ちません）
EXIT=0
```

digitalcloset は `scripts/lib/giga-v5-checks.mjs`（304 行のフォーク）を**持っています**。ツールの文言そのものが嘘で、exit 0 です。
- **括弧内のファイル数を必ず読む。** quoridor / reversi / schoolplan_editor / homework_barcordreader / linker-clipper / omp-pro は「（1 ファイル）」で緑。その裏で schoolplan_editor の `scripts/gas-deploy.mjs` は 182 行、正本は 317 行（135 行遅れ）。

### 0-6. 作業前の値を控える

- ビルド成果物を見る検査があるなら **`npm run build && npm run check` の順**で回す。
- self-test を実走し、**失敗件数を控える**（§1-2）。
- `git status` がきれいなことを確認する（生成物をコミットしているリポジトリで特に重要）。

---

## 1. 「緑」を信じない

### 1-1. 「✅ 0 件」は「検査が動いた」ではない

出力に **「〜が無いため走っていません」「〜は未取得」「— dist が無い」** の行が 1 行でもあったら、その実行を「合格」として報告しないこと。

- digitalcloset をビルドせずに検査すると「※ dist/ が無いため、ビルド成果物の検査（初回JS・総アセット・sw.js の版）は走っていません」と出したうえで **exit 0**。
- quarto は「➖ 初回表示に必要な JS が上限内 — dist が無い」で **29/29 合格**。
- kake_master と reversi は「横断共有の正本 `scripts/lib/project-quality.mjs` は未取得。Part I の検査のみ実行した」で **exit 0**。
- **壊れ方:** 初回 JS が上限を大きく超えた状態や、SW の版が据え置きの状態が、そのまま公開まで進む。

### 1-2. self-test は「0 件」ではなく「増えていない」で判定する

ベースラインはリポジトリごとに違います。**作業前に 1 回走らせて出力を控え、作業後に失敗件数が増えていないことを確認する。もともと落ちている分は直さず、PR 本文に列挙して次の入口として残す。**

実測（現在の typa。全 38 件中 4 件が失敗。self-test 自体は exit 1 を返すが、
**typa の ci.yml は self-test を呼んでいない**ので、この 4 件は誰にも見えていない）:

```
❌ D_SAFE_AREA / D_FLUID_TYPE / D_FORCED_COLORS / E_SW_REGISTER_READYSTATE
   こわしたのに 通りました（この 検査は 何も 見て いません）
```

原因は正本側の作りです: (1) `cssSources()` が `htmlFiles` の `<style>` も CSS として数えるので、`offline.html` に `env(safe-area-inset)`・`clamp(`・`forced-colors` が入っていれば本体 CSS から全部消えても緑（kake_master / keisan-card / keisan-block / kana_master / shiritori_fighter / ice_slide-puzzle / omp-lite でも同じ）。(2) `E_SW_REGISTER_READYSTATE` はファイル全体から `readyState` 比較を 1 つ見つければ合格なので、登録箇所のガードを消しても同じ `app.js` の別の場所が身代わりになる。

- **検査を 1 件でも追加・変更したら、同じ PR で self-test の「こわしかた」も更新し、実走させて反応することを確認する。**
- **self-test が「こわしたのに通りました」と言った検査を ✅ の根拠にしない。**

### 1-3. 検査の対象範囲を疑う

正本の既定は `htmlFiles: ['index.html','offline.html']`、`jsDirs:['js']`、`cssDirs:['css']` のみで、**正本一致の 9 本すべてが既定のまま**です。

- `privacy.html` / `terms.html` / `records-export.html` は `B_CSP` / `B_NO_INLINE_SCRIPT` / `B_NO_CDN_CODE` / `D_VIEWPORT` / `F_IMG_DIMENSIONS` に一度もかかっていません（kake_master・keisan-card・keisan-block・shiritori_fighter・ice_slide-puzzle・typa の privacy/terms は CSP 無しで配信中）。
- React/Vite 系（`src/*.jsx`, `src/index.css`）や GAS の `App.html` は設定を書かないと素通り。townmap_mikke の児童画面 `App.html` は `index.html` ではないので `D_VIEWPORT` の対象外で、`user-scalable=no` が残っています。
- **index.html 以外の配信 HTML を触ったら、対象に足してからゲートを回す。**

### 1-4. 例外を足すときは「そのリポジトリが読むキー」を確かめる

**設定スキーマは統一されていません。** 実測で `exceptions`（werewolf）/ `securityExceptions`（11 本）/ `notApplicable`（5 本）/ `knownDeviations`（quarto）/ `skips` が併存しています。**正本 `giga-v5-checks.mjs:920` が読むのは `skips` だけ**（`id` と `reason` が必須）。しかも kana_master は `standard` の下に入れ子で持っています。

```bash
grep -n "cfg\.\|config\." scripts/check-project.mjs | head -30   # 検査器が読んでいるキー名
```

- **werewolf を例外の手本にしないこと。** werewolf の `quality.config.json` は `appType / budgets / features / exceptions` という v4 世代のスキーマで、v5 リポジトリにその形をコピーしても**読まれず無反応**になります。
- **`AUDIT.md` の節番号を必須にしないこと。** AUDIT.md が無いのは 9 本（GIGAyama.github.io / blackboard_timer / jidosha_zukan / linker-clipper / moral_note / sekigaemaker / shared-folder-sync / tsubomi-learning / word_basket）で、**まさに名指しで直すべき word_basket と moral_note がそこに含まれます**。AUDIT.md があれば節記号を、無ければ理由を `reason` に 3 行以内で直接書く。AUDIT.md の新設は求めない。
- **既存の skip に触るときは、まだ本当なのかを実際のファイルを読んで確かめる。** kana_master は `D_DVH` と `D_FLUID_TYPE` を「Tailwind の生成物だから」で切っていますが、`css/app.css` には `@supports` フォールバックの無い `.h-screen{height:100vh}` が残り、`100dvh` は別の 4 か所で使えていて `clamp(` は 0 件。
  - **壊れ方:** iOS Safari で URL バーが出ている間、`h-screen` の画面は下端が切れる。50 音を 1 画面に並べるアプリで最下段の行が押せない。「Tailwind だから仕方ない」の一文がこれを 10 か月隠す。
- **その場しのぎの正規表現をリポジトリに足さない。** 同じ「メールアドレスの直書き」検査が 7 本で 7 通りになっています（werewolf は gmail|outlook|yahoo しか見ないので独自ドメインの連絡先を見逃す）。shiritori_fighter は現在も警告 2 件（`privacy.html:87` / `terms.html:136`）を出し続けており、これは**意図して載せた連絡先**です。**誤検知は本物の指摘を埋もれさせ、見逃しは児童配布物に個人の連絡先を載せます。** 直すなら正本 `B_NO_SECRETS` に寄せる。

---

## 2. PWA の配信（直したものが端末に届くか）

### 2-1. Service Worker の版 ← **これだけは必須**

**配信物（HTML/JS/CSS/アイコン）を 1 バイトでも変えたら、その PR の中で SW の版が変わること。**

- 形は **行末の目印コメント `/* __APP_VERSION__ */`** です。**定数名は固定ではありません** — `sw-build.config.json` の `versionConst` で決まり、既定は `APP_VERSION`、keisan-card は `VERSION`（`sw.js:18`: `const VERSION = 'v93c20d4a'; /* __APP_VERSION__ */`）。**「APP_VERSION に揃える」と版行が見つからなくなります。**
- 自動採番されているかの判定は 1 行で済みます:

```bash
grep -rn "__APP_VERSION__" . --include=*.js | head   # 空なら手書き版
```

- **独自の build-sw.mjs を書かない**（digitalcloset の 84 行の独自実装は正本 132/163 行と別物、しかも standards-map.json が無い＝drift の死角）。
- **壊れ方:** 2026-08-21 に 12 リポジトリで同時に上げ忘れる事故が実際に起き、追いかけ PR を 12 本出しました（kanji_town #135, keisan-card #27, quarto #19, quoridor #25, reversi #16, ice_slide-puzzle #9, online-100square #27, kana_master #52, qalc #58, homework_barcordreader #36, omp-lite #18, omp-pro #19）。版が据え置きだと古いシェルのキャッシュが掃除されず、**戻ってきた児童の端末に「直したはずの画面」が一度も届きません**。以降の修正すべてが「直したはずなのに直らない」に見え、切り分けに何日も溶けます。
- quarto の自作検査は「sw.js の APP_VERSION が quality.config.json と一致」しか見ないので、両方 v4 のまま配信物だけ変えても緑です。
- 手書きが残っているもの（触ったら自動採番への移行を検討、ただし §0-1 の「任意」枠）: `GIGAyama.github.io/sw.js:17`（定数名は `VERSION`、値 v4）、`gamification/sw.js:32`（`VERSION`、v7）、`gobblet/sw.js:14`、`mirai-compass/docs/sw.js:21`、`online-100square/src/sw.js:16`、`online-publisher-pro/pwa/sw.js:21`、`quarto/src/sw.js:17`、`reflection_journal/docs/sw.js:25`、`townmap_mikke/docs/sw.js:29`、`schoolplan_editor/docs/sw.js:34`。
  **`xxx_automatic/docs/sw.js` は既に自動採番済みです**（`:19` に「VERSION の行は `npm run build:sw` が書き換える。手で直さないこと」、`:35` は `const VERSION = 'vb2940d97';`）。**触らないこと。**
  - `gamification/README.md:165-168` は「`sw.js` の `VERSION` を必ず 1 つ上げてから push してください」と書いています。自動採番へ移すなら **同じ PR で README も直す**こと。直さないと次のセッションが手で版を書き換えて生成器と喧嘩します。

### 2-2. 更新の適用

- **`waiting` へ postMessage → `controllerchange` を待って 1 回だけ reload。** `postMessage` の直後に `location.reload()` を書かない（`townmap_mikke/docs/index.html:512-513`、`reading-books/js/app.js:1982-1983` が現状この形）。
  - **壊れ方:** 新 SW がまだ activate していないので旧キャッシュが返る。児童が「さいしんに する」を押しても画面が変わらず帯がまた出る。そのうち誰も押さなくなる。
- **登録直後に `registration.waiting && navigator.serviceWorker.controller` を見て、updatefound を取り逃した場合も帯を出す。** `updatefound` はページ 1 回の読み込みにつき 1 回しか飛びません。
  - **壊れ方:** 「あとで」を押す／帯が出る前にタブを閉じると waiting SW が居座り、二度と帯が出ない。教室の 40 台のうち何台かだけ古い、という一番追いにくい状態になる。
- **`registerType: 'autoUpdate'` を使わない**（`word_basket/vite.config.js:9`、`notebooksample_generator/vite.config.js:11`）。予告なく再読み込みするので、ワードバスケットを 6 人で囲んでいる最中に盤面が消えます。
- **SW 登録は `load` イベントだけに任せず `document.readyState` も見る**（未対応: gamification/manabi-portal, gobblet, kanji_town, omp-pro, online-publisher-pro/pwa, townmap_mikke）。動的 import で load 後に走るとリスナが二度と発火せず、エラーも出ないまま SW が登録されません。
- 正しい形: `/home/user/quoridor/src/pwa.js:27-39`、`/home/user/keisan-card/js/pwa-boot.js:55-68`。

### 2-3. offline.html / 404.html / manifest

- **offline.html は JavaScript を一切使わない**（`<script>` も `onclick=` も禁止）。**必ず `<a href="./">` でアプリへ戻れるリンクを置く**。SW の先読み一覧にも入れる。
  - 実際に `<script>` があるのは **3 枚**: `gamification/offline.html:75`（インライン）、`gobblet/offline.html:21`、`reading-books/offline.html:44`。
  - **`kana_master/offline.html:111` / `keisan-card/offline.html:22` / `qalc/public/offline.html:11` の「`<script>`」は、使わない理由を書いた HTML コメント本文です。ここを「直す」と手本と理由コメントが消えます。**
  - 戻るリンクが無いもの 9 枚（digital_textbook, gamification, gobblet, kanji_town, omp-pro, online-publisher-pro/pwa, reading-books, reflection_journal, townmap_mikke）、`onclick` 依存 6 枚。
  - **壊れ方:** 本体が読めていない状況で JS に頼るとその JS も読めず、「もういちど ためす」が無反応。戻るリンクも無いと、アドレスバーの無いホーム画面アプリの児童は完全に詰み、手を挙げて授業が止まる。
- **manifest の `id` / `scope` / `start_url` は 3 つとも `./`**（start_url は `./?source=pwa` まで可）。絶対 `/` のまま: kanji_town, mirai-compass, reading-books, reflection_journal, GIGAyama.github.io（`site.webmanifest`、id 無し）、sekigaemaker（id/scope 無し）。word_basket は `start_url:'.'`/`scope:'.'` で id 無し。
  - **壊れ方:** サブパス配信に一度でも戻ると scope がページ URL を含まず、manifest ごと無視されて「アプリを入れる」が消える（kana_master が `/KANA_Master/` でインストール不能だった事故と同じ形）。sekigaemaker は 256x250 のアイコン 1 枚しか無く、**今すでにインストールできません**。
- **SW を持つアプリには 404.html を置き、その中のリンクはルート絶対パス（`/…`）で書く。** 手本と理由コメントは `/home/user/kana_master/404.html:11-23`。kanji_town はソースに無いだけで `package.json:8` の build が `cp dist/index.html dist/404.html` を行っています。
- **キャッシュの掃除は自分の接頭辞で始まるものだけに限る。** 27 本すべてで守られています（`GIGAyama.github.io/sw.js:49` は `k.startsWith('giga-school-')`、`gamification/sw.js:70` は `key.startsWith('manabi-')` とリテラル直書き）。**この規律を「整理」で崩さないこと** — 接頭辞なしの全消しは、同一オリジンに同居する records-hub のキャッシュまで落とします。

### 2-4. 重さは「バイト」ではなく「ms」で判断する

**`typa/AUDIT.md:415-460` に、バイト削減が効かないことを実測で示した記録があります。**

> 480KB → 262KB（45% 減）。…**JS の 量が きいて いたのは 11ms だけ**でした。
> 打鍵を うけつける: 986ms → 954ms（CPU 4 倍遅い実ブラウザ・10 回の中央値）
> 内わけ: 打つ画面の初回レイアウト 約 640ms（65%）、うち `fitKeyboard()` 約 215ms

typa は**この数字を理由に、削る仕組みを入れない判断をしました**（`7-2`「けっきょく 入れて いません」）。

- **壊れ方:** 「300KB を超えているので削る」という作業に半日使い、1% しか速くならず、ソースと配信物が二重になる仕組みと「build を忘れる事故」だけが残る。本当の犯人（1 回 93ms の `getBoundingClientRect`）は手つかず。
- **規律:** 重さを触るときは、削る前後の **ms を両方出す**。数字が動かないなら削らない。測る道具を持つのは `typa/scripts/measure/`・`qalc/tools/measure/`・`omp-lite/tools/measure/`・`digital_textbook/scripts/measure/` の **4 本だけ**で、この環境にはブラウザが無いので（§0-0）それ以外では **「未計測」と書く**。
- バイト上限は「天井」として残してよいが、それ自体を作業の理由にしないこと。良い前例は `/home/user/qalc/quality.config.json`（`initialJsBytes` と `initialJsTarget` を併記し「到達不能な値で毎回落としつづけると検査そのものが無視されるようになる」と理由を残している）。
- `'./'` と `'./index.html'` を両方並べて同じ中身を二重に持たない（omp-pro は 180KB を二重計上）。
- **`docs/note/images` の画面写真は 1 枚 150KB 以内・アプリ合計 2MB 以内。** 現状 10MB 超が 5 本（online-publisher-pro 13.0MB, schoolplan_editor 12.1MB, townmap_mikke 11.9MB, mirai-compass 11.8MB, typa 10.2MB）。keisan-card は 19 枚で計 672KB＝同じ種類の写真で 18 倍の差があり、達成可能なことは実証済み。
  - **壊れ方:** 先生が職員会議でアプリを紹介する場面で、40 台が同時に開いて数百 MB が校内 Wi-Fi に流れ、画像が半分も出ないまま時間切れになる。
- **ポータルの紹介ページから `raw.githubusercontent.com` を参照しない。** 現在 `/home/user/GIGAyama.github.io/apps/` 配下 11 ページで計 490 回参照（og:image も）。多くの校内フィルタで塞がれ、オフラインでは全滅します。

---

## 3. 外部依存（この流儀の根幹）

**アプリの実行コードを外部から読み込まない。** React / Tailwind / SweetAlert2 / Babel は `vendor/` に同梱して先読み一覧に入れる。SW の実行時キャッシュに外部 CDN ホストを列挙しない。

- `@babel/standalone` をブラウザで走らせている 5 本（haiku-meeting, linker-clipper, omp-pro, online-publisher-pro, townmap_mikke/App.html）は、ビルド済み JS に置き換える。omp-pro は 7 ホストから読み、`sw.js:33-40` の `RUNTIME_CACHE_HOSTS` に CDN を列挙しています（APP_SHELL に自前 JS が 1 本も無い）。
- **ふりがなを外部 CDN の形態素解析（kuroshiro / kuromoji）で付けない。** `gamification/manabi-quest/js_core.html:1036-1071` は 6MB の辞書を jsdelivr から取り、タイムアウト 60 秒、catch は `console.warn` だけ。
- **壊れ方:** 校内フィルタが unpkg / jsdelivr / cdn.tailwindcss.com を塞ぐと、SW がシェルを配ったあとで本体が起動せず真っ白。「オフライン対応済み」に見えて圏外で一切使えない。ふりがなは黙って消え、教員は「今日は動きが変」としか分からない。
- **フォントも同じ線で考える。** `fonts.googleapis.com` を配信 HTML で読んでいるのは 32 リポジトリ、自己ホストは `reading-books/fonts/zen-maru-gothic/` と `werewolf/scripts/build-fonts.mjs` だけ。`homework_barcordreader/MANUAL.md:239-243` は「見た目が少し変わるだけで、動作には影響しません」と書いていますが、**かな・漢字・書写を教えるアプリでは字形が教材そのもの**です。丸ゴシックが素のゴシックに落ちると kana_master / kanji_town / tsubomi-learning は誤った手本を児童に見せます。字形が教材の一部であるアプリだけは自己ホストか、システムフォントで成立する設計にすること。それ以外は「実行コードではないので外部でよい」と決めて `quality.config.json` に理由を残す。
- **例外を残す判断は必ず人に確認する。** kanji_town は jsdelivr / unpkg / fonts.googleapis から PeerJS・qrcode・jsQR・本文フォントを取り、そのうえ `no-csp` まで例外化。online-publisher-pro は React/ReactDOM/Babel/Tailwind/diff_match_patch/QRCode.js を CDN から読んで **56/56 合格**と表示します。
- **`vendor/` に何かを置いたら、同じ PR で第三者表記に「名前・版・ライセンス・入手元」を書く。** vendor を持つ 6 本のうち表記があるのは kana_master と schoolplan_editor の 2 本だけ。ice_slide-puzzle の sweetalert2 v11.14.5 は devDependencies に無く **Dependabot の射程外**です。
- 撤去済みの手本: `/home/user/keisan-card/index.html:96-108`（vendor/react、106 行に理由コメント）、`/home/user/online-manuscript-paper-lite/vendor/`（計 228KB を同梱）、`/home/user/reflection_journal/docs/drive-app.js:98-140`（自前の読み表、外部依存ゼロ）。

---

## 4. 学習記録の受け渡し（records / ハブ）

学習記録に関わるファイル（`records-export.html` / `records-export.js` / `records-hub-client.js` / `index.html` の script タグ / CSP の `frame-src` / SW の precache）を触ったら、**この環境では `check:bridges` が回せない**（§0-0）ので、その場で目で確かめる 5 点:

1. `records-export.html` が公開ルート直下にある
2. その `<script src>` が**実在する** `records-export.js` を指している（`check-bridges` は html の 200 しか見ず、js は直下→`js/` の順に fallback するので、置き場を移して src を直し忘れても本来は緑）
3. `records-export.js` の `APP_ID` が manabi-portal の `RECORD_SOURCES` と一致
4. `index.html` に `<script src="…/records-hub-client.js" defer>` の 1 行がある
5. CSP の `frame-src` に `https://gamification.giga-school.com` がある

**アプリ側リポジトリの CI が緑でも、それは受け渡し口を 1 バイトも見ていません。** `records-export.html` は**どの standards-map.json にも載っていない**ので、削除しても改変しても全 CI が緑で通ります。
- **壊れ方:** typa の js/ を整理したついでに `records-export.html` を消しても、typa の CI も drift も緑、リリースも成功。数週間後に誰かが gamification を触ったとき初めて落ち、その間のタイピング学習の記録は取り寄せられていない（`gamification/tools/check-bridges.mjs:8` に、kana-master で実際にこの欠落が起きたと記録されています）。

### 4-1. `appId` を書き換えるときは 4 か所を同じ PR で揃える（必須）

① 各アプリの `studySession`（`rec.appId`）② `records-export.js` の `APP_ID` ③ manabi-portal の `RECORD_SOURCES` ④ `manabi-quest/10_studylog.gs` の `STUDY_APPS` と `STUDY_APP_LINKS`。機械照合されるのは ②↔③ だけです。
- **壊れ方:** studySession だけ直すと GAS の `validateStudyRecord_` が `fail('appId')` で弾く。appId は `STUDY_RETRYABLE_REASONS` で「一時エラー」扱いなので端末に残り続け、未送信が静かに積み上がる。先生には「送っても減らない」としか見えない。`STUDY_APPS` だけ忘れると「ひらけるのにきろくが届かない」、`STUDY_APP_LINKS` だけ忘れると「きろくは届くのに一覧に出ない」。**新アプリを繋ぐときは GAS の再デプロイまで済ませてから「繋いだ」と報告すること。**

### 4-2. `schema` は完全一致で、しかも再試行されない

```js
// gamification/records-hub.html:154
if (rec.schema !== 'study.v1') return false;
// gamification/manabi-quest/10_studylog.gs:986
if (rec.schema !== STUDY_SCHEMA) return fail('schema');   // STUDY_SCHEMA = 'study.v1'
// 10_studylog.gs:181  ← schema は入っていない
const STUDY_RETRYABLE_REASONS = { 'appId': true };
```

- **壊れ方:** 1 本のアプリの記録に項目を足して `schema` を `study.v2` に上げる（正しい作法に見える）。ハブは 1 件も写さず、GAS は `fail('schema')` で弾き、**retryable ではないので端末の未送信キューからも消えます**。その日以降そのアプリの記録は「どこにも無い」状態で失われ、先生には「そのアプリだけ記録が来ない」としか見えない。同じファイル `:178` のコメント自身が「ここで削除すると、児童が学習したきろくが誰にも気づかれないまま永久に失われます」と警告しています。
- **規律:** 記録の形（フィールド追加・schema 文字列）は勝手に変えない。変えるなら 9 アプリ・ハブ・GAS の 3 面を同じ作業で揃え、GAS を再デプロイし、**旧 schema を一定期間受け付ける経過措置**を入れてから。それができないなら形を変えない。

### 4-3. そのほか

- **既知の未修正バグ:** `standards/records/records-hub-client.js:195` の `const fresh = (mark.count <= log.length) ? log.slice(mark.count) : log.slice();` は、原本が上限 500 件に張り付くと `mark.count=500 / log.length=500` で fresh=[] になり、**そのアプリの写しが永久に進みません**。id 集合との突き合わせを主にし count は補助に落とすこと。`records-hub-client.js` は 238 行・10 リポジトリへ配布・**テスト 0 件**なので、直すならテストを先に。
- **レコードの粒度・頻度・items の量を勝手に増やさない。** 端末側は 500 件で先頭から捨て、ハブ側は上限なしで積みます。「1 問 1 レコード」にすると 5 回の練習で天井に当たり、午前の記録が午後に消える。
- **`studyLog.js` を「共通・不変」と信用しない。** コメントは「全アプリでまったく同じ動きをする」と宣言していますが、公開面は 5 通りに割れています（kana_master/typa 型、keisan-card 型、reading-books 型、keisan-block は `saveStudyRecord` だけ、ESM 4 本は名前付き export のみ）。standards に正本が無く drift も見ていません。**`StudyLog.KEY` のような公開プロパティに依存するコードを新たに書かない。**
- **localStorage を掃除するコードは必ず「消すキーの許可リスト」で書く。** 「KEEP に無いものを消す」という否定形に書き換えない。`study.records.v1`（未送信の原本）と `study.hub.mirrored.v1`（写した控え）は自アプリ専用ではないので、リセット・初期化・容量不足のどの経路からも触らない。手本は `kanji_town/src/systems/storage.js:187-204`。ゲートの `C_NO_LS_CLEAR` は `localStorage.clear()` しか見ておらず、removeItem のループは見ていません。
- **postMessage の宛先は必ず具体的なオリジン**、受け側は `^` と `$` で全体一致。**取り寄せ用 iframe に `sandbox` を足さない**（origin が `"null"` になり 9 本すべてから 1 件も返らなくなる）。この 2 つは既存コードのコメントで明示的に禁じられています。「整理」しないこと。
- **kanji_town の `sw-build.config.json` の precache に `records-export.html` / `records-export.js` / `records-hub-client.js` を追加すること。** 現在これらは版ハッシュの対象外なので、直しても版が動かず、**一度でも開いた端末は古いブリッジを永久に使い続けます**。

---

## 5. GAS（.gs）— CI に一切守られていない領域

正本ゲートの検査項目は **38 件**（A_LICENSE 〜 F_IMG_DIMENSIONS）で **GAS 関連は 1 つもありません**。一方 `standards/gas/deploy.yml` は main への push で clasp push と既存デプロイ差し替えを行うので、.gs の間違いは数分で教室に届きます。**PR ごとに自分でチェックリストを回し、結果を PR 本文に書くこと。**

### 5-1. 認可の入口（必須）

```bash
grep -n '^function [a-zA-Z]' *.gs | grep -v '_(' | wc -l   # 公開エンドポイントの数
```

- **`google.script.run` は末尾 `_` の無いトップレベル関数を誰でも直接呼べます。** 内部ヘルパーを新設したら必ず末尾に `_` を付ける。
- 現存する穴（触るときは直すこと）:
  - `gamification/manabi-quest/04_records.gs:503 getMyRecords(email)` — 児童がコンソールで他人のメールを渡すだけで、その子のテストの点数・道徳の記録・読書・成長記録・目標が丸ごと返る
  - `townmap_mikke/Legacy.gs:72 lgSyncData` — 兄弟関数は全部 `lgEmail_()` で始まるのにこれだけ本人確認なし
  - `moral_note/code.gs:764 getAnonymousOpinions` — 過去のどの授業でも児童の記述本文が全部引ける
- **「メニューからしか呼ばれない」関数も公開エンドポイントとして扱う。** `SpreadsheetApp.getUi()` が Web アプリ文脈で例外になることを防御と数えない。`gamification/manabi-quest/09_ops.gs:245 archiveYearEndData`（データ行を deleteRows する）は、ダイアログをやめて引数で受け取るリファクタを 1 回入れた瞬間に、児童が学級 1 年分のデータを消せる関数になります。
- **認可はガード関数 1 本に集約する。** `moral_note` には `assertTeacherOrSelf_`（code.gs:151）があるのに `submitLog`（:627）だけ自前の弱い判定を書いており、名簿にメールが未登録の学級では本人確認が丸ごと素通りします。
- **ブートストラップは「初回だけ開く」形を維持し、広げない。** `mirai-compass/code.gs:245-248` は再初期化を `MiraiAuth.isTeacher()` で拒否しますが、**未セットアップの初回だけは誰でも通り、その本人が最初の先生になります**（コード自身がそう明記）。先生がセットアップする前にリンクを配ると、最初に開いた児童が恒久的に「先生」になり、取り消すには ScriptProperties を手で書き換えるしかありません。

### 5-2. データ境界

- **「誰の記録か」を引数から決めない。** 書き込む email は `Session.getActiveUser()` か `verifyIdToken_` の戻り値だけ。読む対象は本人または担任であることをサーバー側で確かめてから使う。
  - `physicaleducation_note/code.gs:394 saveLog(email,…)` は 22 関数すべてが公開・認可ゼロで、`getStudentDetailForTeacher` と `getAllLogsForCsv` も無認可（学級全員の氏名＋コメントを CSV で吸い出せる）。haiku-meeting は身元が localStorage の文字列だけで、voterId を変えながら 1 人で票を積めます。
- **`openById` 失敗時に create して setProperty で ID を差し替える自己修復を、児童が通る経路に置かない。**
  - `physicaleducation_note/code.gs:23-35` の `getHealthySpreadsheet()` はまさにこの形で、しかも `executeAs: USER_ACCESSING` なので児童一人ひとりの権限で走ります。**名簿シートに権限のない転入生が 1 回開くだけで、学級全員の記録が入ったシートからその子の空シートへ差し替わります。** 画面にエラーは出ず「記録が消えた」ようにしか見えず、旧シートは誰の画面にも紐づきません。
- **スプレッドシートと画像フォルダを `ANYONE_WITH_LINK + EDIT` で共有しない**（フォールバック先も含めて）。`online-publisher-pro/code.gs:164-192` は個人アカウントでもドメイン共有禁止時でも EDIT にフォールバックします。手本は `digital-newspaper/Code.gs` の `applyPhotoSharing_`（2026-08-23 時点で :750-773）。
- **役割やモードをクライアントの引数に決めさせない。** `online-publisher-pro/code.gs:316-318 getDraftList(mode, token)` は `mode !== 'teacher'` なら素通しで、else 枝が `teacherCmt` と `correction` を含めて返します。
- **列を見出し名で読むと決めたなら、書くほうも見出し名で組む。** README に「列はヘッダー名で探すので、入れ替えても動きます」と書いてあっても、書き込みが `appendRow([a, b, c, …])` の位置決め打ちなら**その約束は守られていません**。先生が列を 1 本入れ替えた瞬間から、本文が記者名の列に入ります。画面には何も出ず、**印刷するまで誰も気づきません**（digital-newspaper で実際に起きていた。2026-08-23 の PR #9 で修正）。

```bash
# 横断：読みは名前・書きは位置、という食い違い
grep -rn "appendRow(\[" $(git ls-files '*.gs') | grep -v "header\|HEADER"
```

- **見つからない列を「たぶん N 列目」で埋め合わせない。** `idx.tag = getIdx('Tag') !== -1 ? getIdx('Tag') : 7` という形。`Tag` の見出しが無く、8 列目に先生のメモ欄があるシートでは、**メモの中身がタグとして児童の記事一覧に並びます**。無いものは「無い」（空）として扱うほうが、点検で気づけます。

```bash
# 「見つからなければ N 列目」。三項演算子の右が数字リテラルなら、まず疑う
grep -rnE "!== *-1 *\?.*: *[0-9]+" $(git ls-files '*.gs' '*.html')
```

- **シートの修整は「足す」と「書き方をそろえる」だけにする。消す・動かすは人がやる。** とくに、**見出しの行ごと消えている（＝1 行目がデータになっている）状態で見出しだけを書き戻してはいけません**。間違った列に正しいラベルが付き、そこから先は誰も間違いに気づけなくなります。手本は `haiku-meeting/code.gs:59-121`（点検のみ）と `digital-newspaper/Code.gs` の `checkSchema_` / `repairSchema_`（点検と、安全な範囲の修整を分けた形）。**コピー配布のアプリでは、先生が列をさわるのは想定外の事故ではなく、起こる操作として扱うこと。**

- **利用者の入力をセルに書く前に、先頭が `= + - @` タブなら `'` を足して無害化する**（CSV も同じ関数を通す）。持っているのは online-publisher-pro の `safeCellText_` と reflection_journal の `csvSafe_` だけ。`digital-newspaper/Code.gs` の `saveArticle`（2026-08-23 時点で :849-896）は**いまも素通し**＝児童が題名に `=IMPORTXML("http://…"&A2)` と書くと、先生が開いた瞬間に学級の記事データが外部へ流れます（同日の PR #9 で書き込みを見出し名で組む形に直しましたが、無害化はまだ入っていません。**そこが次の 1 本です**）。

### 5-3. 排他制御とクォータ（40 台が一斉に叩く前提）

- **教室で一斉に叩かれる更新（記録の追加・経験値の書き戻し・行の更新削除）は LockService で囲む。** 囲む範囲は `appendRow` / `setValues` の 1 回分に絞り、トークン検証やシート全読みはロックの外に出す。手本は `townmap_mikke/Db.gs:120-143`（`withScriptLock_` / `appendRowLocked_`）。
- 実測: moral_note **0 件**、physicaleducation_note **0 件**、gamification **1 件**、townmap_mikke 3 件。
  - **壊れ方:** 40 人が一斉に送信する道徳の授業で同じ児童の Before が 2 行入り、散布図が二重点になって変容集計が壊れる。「すでに送信済み」も出ないので誰も気づかない。朝の会の同時ログインで経験値が互いに上書きされ、レベルが巻き戻る。
- **ロックの中から、自分でロックを取る関数を呼ばない。** 手元では動くので気づけません（本番だけが待って落ちます）。偽の `LockService` に「握ったまま `waitLock` されたら例外」を入れておくと、テストで見つかります（手本: `digital-newspaper/tests/helpers/gas-sandbox.mjs`）。実例: `updateArticleTag` がロックを握ったまま、列を足すために自分でロックを取る `articleColumns_` を呼んでいた。
- **画像・base64 の復号・ドライブへの書き込みをロックの中に入れない。** 1 件あたり数秒かかるので、40 人ぶんが直列になって合計が児童側の再送（たとえば 2+4+6 秒＝最長 22 秒）を追い越します。**全員が落ちるのではなく、後ろの数人だけが黙って落ちます。** 先生の画面には何も出ません。
- **ポーリングを足す・間隔を縮めるときは「40 人 × 何 req/分」を PR 本文に書く。非表示タブでは必ず止める。同じリポジトリに複数のポーリングを作らない。**
  - `moral_note/js.html` には**ポーリングが 2 本**あります（`:52` は `if (!isPageVisible) return;` あり、`:1514` は**非表示ガード無し**）。40 人学級で常時 8 req/s 相当が GAS に当たります。
  - 唯一の手本が `townmap_mikke/README.md:359-360`（同時実行 約 30 / UrlFetch 日次 20,000 回、ID トークン検証は TTL 300 秒のキャッシュ前置）＋ `App.html:3992`（`if(document.hidden) return;`）。
  - **壊れ方:** 上限に当たった数人だけが「サーバーから返事がありません」。ロックは通っているので重複は起きないが、その数人の Before が欠けたまま散布図が描かれ、誰も気づかない。

### 5-4. スコープとデプロイ

- **`appsscript.json` を必ずリポジトリに置き、`webapp`（executeAs / access）と `oauthScopes` を明記したままにする。** **無いのは mirai-compass だけ**です（gamification は `manabi-quest/appsscript.json` に 30 行あります — リポジトリ直下に無いだけなので、重ねて作らないこと）。haiku-meeting は 6 行しかありません。
  - **壊れ方:** `clasp push` は GAS 側のマニフェストを丸ごと上書きするので、無いまま送るとウェブアプリの入口が消える（schoolplan_editor で実際に発生、コミット 07f0938）。`oauthScopes` が無いと GAS が保存のたびにスコープを推測し、DriveApp を 1 行足しただけで同意画面が広がって既存の承認が無効になり、授業中に全員が同意画面で止まる。
- **コンテナバインドのコピーを配るアプリで `executeAs: USER_DEPLOYING`（＝「自分」実行）を選ぶときは、身元の判定を必ず `Session.getActiveUser()` だけで行う。** この形では `Session.getEffectiveUser()` は**誰が開いてもデプロイした先生**を返すので、認可に使った瞬間に学級全員が先生として通ります。`getEffectiveUser()` を使ってよいのは、メニュー（コンテナバインド文脈）からしか呼ばれない関数だけです。
  - 利点は大きい: 児童が先生のスプレッドシートにもドライブにも**アクセス権を持たなくてよくなる**（＝児童がシートを直接開けない、`onOpen` を動かせない、初回にメニューを動かした人が管理者になる穴が構造的に塞がる）。
  - 代わりに `Session.getActiveUser().getEmail()` は `access: DOMAIN` に限ってしか取れません。**`access` をドメイン外に開くと空文字になり、誰も管理画面に入れなくなります。** 変えたら本番で「先生のアカウントで管理画面が開けるか」を必ず 1 回確かめること（手元では確かめられません）。
  - 実例: digital-newspaper（2026-08-23 の PR #9）。**この環境では GAS を実行できないため、本番での挙動は未確認のまま出しています。**
- **GAS へ送るファイルの名前を変えたら、次の反映は「止まる」のが正しい。** `gas-deploy.mjs` の `deletions()` が「送るとGASから消えるファイルがあります」で停止します。1 回だけ `GAS_ALLOW_DELETIONS=1` を付けるか、GAS エディタで古いファイルを先に消す。**止まらないほうが危ない**（学校が使っている最中に消えると戻せない）。
- **`oauthScopes` を広げない。** とくに `executeAs: USER_ACCESSING` で `auth/drive`（フルドライブ）を要求しない（online-publisher-pro と physicaleducation_note が該当）。保護者説明で「子どものドライブ全部を読めます」と言わざるを得なくなります。手本は `townmap_mikke/appsscript.json`（3 スコープ、`Main.gs:18-27` に DriveApp を使わない理由）と `schoolplan_editor`（drive.file に留めている）。
- **デプロイのやり直しは「デプロイを管理 → 既存デプロイを編集」。「新しいデプロイ」を作らない**（`/exec` の URL が変わり、学級に配ったリンクが全部切れる）。
- **2 本デプロイ（townmap_mikke / reflection_journal）では `--deploymentId` を外さない。** 崩すと児童用が USER_ACCESSING になり、`openClassSs_` が `CLASS_UNAVAILABLE` を返し続けて、授業中に学級全員の画面が同時に同じエラーになります。
- **「main にマージした＝本番に反映された」と書かない・思わないこと。** シークレット未設定のリポジトリでは Deploy が全ステップ skipped で数秒で success を返します（Gamification run 32546338803 は 6 秒で success、全ステップ skipped。townmap_mikke・reflection_journal も同様）。**所要時間と各ステップの conclusion を見て確かめる。**
- **package.json に `quality` / `ci` / `check` のいずれかを用意してから .gs を触る。** 正本 deploy.yml はこの 3 つを順に探し、どれも無ければ「飛ばします」と表示して緑のまま本番へ push します（該当: moral_note, townmap_mikke, physicaleducation_note, haiku-meeting。haiku-meeting は ci.yml では生成物一致も管理者認可テストも回しているのに、deploy 経由では全部飛びます。**digital-newspaper は 2026-08-23 の PR #9 で `check` / `test` / `ci` を用意して外れました**）。
- **`.gitignore` に `.clasprc.json` と `.clasp.json` があることを確認してから clasp を使う**（linker-clipper と shared-folder-sync に無い）。`~/.clasprc.json` は Google アカウントの鍵そのもので、入った時点で児童の学習記録が入っている全 GAS プロジェクトが第三者に触れます。
- **手元から本番へ直接配信するコマンド（`npm run deploy` の gh-pages 直押し、`gas:push` の単独実行）を使わない。** ゲートを通らず、ローカルが古ければ他人の変更を巻き戻した状態を本番に押し出します。gh-pages は PR 履歴に残りません。
- .gs のテストは **`standards/gas/Gemini.test.mjs` と同じ形**（`vm.createContext` で SpreadsheetApp / PropertiesService / LockService / Session / Utilities を偽物に差し替え、ソースをそのまま実行）で書く。**関数を正規表現で切り出す方式は避ける**（`gamification/tools/check-exp.js:25` は書き方を少し変えただけで「読み取れませんでした」と落ちます）。手本: `schoolplan_editor/tests/helpers/webapp-sandbox.mjs`（366 テスト）。

---

## 6. AI と個人情報

- **AI へ送る文字列は、必ず仮名化関数を通した戻り値しか渡さない。** プロンプト組み立ての中で生の変数を文字列連結しない。
  - 素通しの現存箇所: `reflection_journal/OwnerApi.gs:627,656`、`moral_note/code.gs:971-989 / 1200-1224`、`online-publisher-pro/code.gs:667-698`、`omp-pro/index.html:647`。
  - **壊れ方:** `opAiSimple` は未返却ジャーナルを一括処理するので、事故は 1 件ではなく**クラス全員分まとめて**起きます。「きのう〇〇くんのおうちで…」「おかあさんの携帯 090-…」が 40 人分そのまま米国の Gemini へ。先生の画面には「AIコメント案を作成しました（成功40件）」としか出ません。
- **仮名化は fail-closed。** 名簿が読めなければ AI 呼び出しを中止して先生にエラーを見せる。空の対応表を返して続行しない、失敗結果をキャッシュに入れない（`gamification/manabi-quest/07_ai.gs:70,83-87` は catch で `aliases={}` を作りキャッシュに入れるため、一括処理の最初の 1 回のシート読み失敗で、残り全員が実名のまま流れます）。
- **仮名化関数の第 2 引数（名簿・スプレッドシート）を省略可能にしない。** `sanitizeForAi_(value, ss)` の ss 省略時フォールバックが失敗すると無加工の文字列がそのまま返る＝**呼び忘れが「エラー」ではなく「素通し」として現れる**ので、レビューでもテストでも気づけません。
- **送信直前に「実名・連絡先が残っていないか」を機械的に検査し、1 件でも見つかったら送信ボタンを無効にする。** 4 実装すべてが `name.length < 2` で 1 文字名を仮名化対象から外しています（判断自体は正しい）。結果、「光」「愛」といった 1 文字名の児童だけが毎回・恒久的に実名で送られます。手本は `homework_barcordreader/src/teacherAiPrivacy.js:206-219` ＋ `TeacherAiPanel.jsx:194`（`disabled={… || identifiers.length > 0}`）。
- **API キーは `x-goog-api-key` ヘッダで渡す。`?key=` は禁止。** 違反: `digitalcloset/src/App.jsx`（6 か所）＋ `localStorage` 平文、`online-publisher-pro/code.gs:681`（再試行も無いので一斉に押すと 429 の数人だけ黙って落ちる）。理由は `omp-pro/index.html:627-630` に書かれています（URL は履歴・SW のログ・途中の機器の記録に残る）。
- **`console.log` / `Logger.log` / `console.error` に児童の本文・プロンプト・Gemini の応答本文・API キーを渡さない。** requestId と HTTP コードだけ。`online-publisher-pro/code.gs:719` は 200 以外のとき応答本文を丸ごと Cloud Logging へ出し、`exceptionLogging: STACKDRIVER` で 30 日残ります。privacy.html には「実行ログ」の記載が無い＝説明していない保存が発生しています。
- **AI の生成文を、先生の確認を経ずに児童へ届けない。** シートや DB に書くのは可、児童画面・Classroom への配信は必ず先生の「返す」操作を挟む。`gamification/manabi-quest/07_ai.gs:1064-1092` は生成直後に担任名義で個別お知らせを投稿します。**道徳ノートには家庭の事情・死別・いじめが書かれます。** そこに AI が的外れに「すばらしい気づきですね」と返り、担任は投稿されたことすら知らない。
- **AI を呼ぶ関数の 1 行目で権限を確認する。** 児童が呼ぶ AI 機能には名簿照合と 1 人あたりの回数制限を付ける。`moral_note/code.gs:971 generateSocraticQuestion` は児童画面から任意の文字列で呼べて照合も制限も無く、access は DOMAIN＝校内全員が射程。ループで叩けば先生の課金キーが一晩で溶けます。手本と理由は `mirai-compass/code.gs:2020-2023`。
- **同じリポに AI 経路が複数あるときは、同意ゲート・仮名化・先生確認をすべての経路に同じ形で入れる**（reflection_journal は Drive 版だけ同意チェックがあり GAS 版の一括送信には無い。townmap_mikke は同じプロンプトが TeacherApi.gs と Legacy.gs の 2 か所にある）。
- **`privacy.html` の主張と実装を一致させる。** 「送信しないもの：児童の氏名」と書きながら題名・本文を無加工で送っているのが 3 本（online-publisher-pro, omp-pro, reflection_journal）。reflection_journal は「キーは先生の端末のブラウザ内にのみ」と書きながら、テナントのスプレッドシート「設定」シートに平文保存しています。
  - **壊れ方:** 学校が保護者説明会でこの紙を配った後に実装が発覚すれば、外国第三者提供の説明が虚偽だったことになる。**取り消しがきかない種類の事故で、アプリではなく先生個人の信用問題になります。** 直す順は「先にポリシーを実装に合わせて直し、次に実装を強くする」。手本の検査は `schoolplan_editor/tests/privacy-policy-claims.test.mjs`（38 項目のゲートに AI・個人情報の検査は 0 件で、`B_NO_SECRETS` は `AIza…35 文字`の直書きしか見ません）。

---

## 7. 教室で使われる画面（こどもが困る形で壊れる）

### 7-1. 拡大・ふりがな・コントラスト

- **`user-scalable=no` / `maximum-scale=1.0` を消す。** 現存: `word_basket/index.html:8-9`（quality.config.json 自体が無く検査が一度も走っていない）、`townmap_mikke/App.html:5`。
  - **壊れ方:** `werewolf/src/index.css:341-347` に「設定画面が 3 枚分あり下端に『ゲーム開始』がある。バーが見えないうえ拡大もできず『スクロールできない』と受け取られていた」という記録が残っています。ワードバスケットは 1 台を 2〜6 人で囲むので、後ろから覗く子は何も読めません。
- **`rt` の color は白地の既定値ひとつだけ。** 色のついた面（`button` / `a` / `.badge` / `[class*="bg-"]` / `[class*="btn"]`）はセレクタでまとめて `color: inherit` を継がせる。**1 か所ずつ個別に色を当て直さない**（悪い形: `jidosha_zukan/index.css:392-394, 837-839`）。
  - **壊れ方:** 色つきボタンの上に `#8d6e63` のふりがなを重ね、コントラスト比が「開始/リセット」で **1.03**、「待った！」で 1.68 しか出ていなかった（記録: `reversi/src/index.css:267-292`）。ふりがなを必要とするのは低学年＝いちばん読めなくて困る子がいちばん読めない。個別パッチだと新しい色のボタンを 1 つ足すたびに静かに再発します。
- **「漢字（よみ）」→ルビの正規表現を書いたら、実データ全件を流して base と rt の対応を目視確認する。**
  - `kanji_town/src/components/ui/FormatKun.jsx:14-38` は直前のひらがなも base に飲み込みます。実データで「漢字（かんじ）を10文字（もじ）マスターする」は base「を10文字」rt「もじ」。**漢字を教えるアプリで、児童は「を10文字＝もじ」と読み方を覚えます。** 正しい設計は `reflection_journal/docs/drive-app.js:94-121 splitReading`（割れないものは null を返して語まるごとのルビへ落とす）。
- **`<ruby>` には `<rp>（</rp>` を必ず添える。** 読み上げ・aria-label・音声合成へ渡す文字列はルビを剥がした素のことばにする（手本: `gobblet/js/furigana.js`、`kanji_town/src/utils/tts.js:20-27`）。rp 0 件のファイルが多数（jidosha_zukan/cars-data.js は ruby 256 に対し rp 0、physicaleducation_note/index.html は 60 対 0）。
- **ベースライン揃えのために 1 文字ずつ `<ruby>{ch}<rt></rt></ruby>` で包まない**（`kanji_town/FormatKun.jsx:20-23,47-57,73-79`）。スクリーンリーダーが「ね」「こ」「が」と 1 字ずつ読み、語として聞こえません。行の高さは CSS で揃える。
- **`<html lang="ja">` を必ず書く**（`moral_note/index.html:2` と `physicaleducation_note/index.html:2` が `<html>` のみ。両方とも児童向けでルビを多用）。CJK フォントが中国語字形に落ちると、漢字を目で写す用途では字形そのものが誤りになります。
- **学年チェックは説明モーダルだけでなく、実行中のトースト・確認ダイアログまで含める。** `word_basket/src/App.jsx:391`「パスしました（場札更新）」の「更」は中学配当（同ファイルの説明モーダルは全語にルビ付き）。`keisan-card/src/App.jsx:2079-2083` は「全文ひらがな」と宣言して rubyColor 検査を免除しているのに、**取り消せない削除の確認文だけ**「れんぞく記録」と 6 年配当の字が残っています。

### 7-2. 触れる・見える・伝わる

- **タップ目標 44px は、この環境では測れません（§0-0）。** 測る道具を持つのは kake_master / quoridor / xxx_automatic の 3 本だけ。**測れないなら「未計測」と書き、チェックを付けない。当たり判定に手を入れない。** 測れる場合は `::after` で広げ、**広げた分だけ隣との gap も同時に広げる**（重なると押したつもりと違うボタンが反応する＝低学年で最も多い誤操作）。**モーダル・折りたたみは開いてから測る**（`keisan-block` の `.free-method-btn` 298×40.2 は「かくれた状態を出してはじめて見つかった」）。
- **`outline: none` を書いたら、同じルールの中に見える代替（outline か box-shadow）を必ず置き、さらに `@media (forced-colors: active)` で `outline: 2px solid Highlight` を足す。box-shadow だけの代替は禁止**（forced-colors では描画されません）。`tsubomi-learning/index.css:319` は小 1 国語用なのに `:focus-visible` が 0 件で、キーボードだけで使う児童はカーソル位置が最初から分かりません。
- **`viewport-fit=cover` を書いたページには必ず `env(safe-area-inset-*)` の padding を入れる。** 下端固定の操作要素は `calc(最低余白 + safe-area-inset-bottom)`（手本: `digitalcloset/src/index.css:44-60`、`werewolf/src/index.css:335-339` の `max(1rem, var(--safe-b))`）。cover を書いて env が 0 件なのは jidosha_zukan / moral_note / music-production_studio / notebooksample_generator / tsubomi-learning / shared-folder-sync / linker-clipper。
- **framer-motion を使うなら `<MotionConfig reducedMotion="user">`（または OS 設定から算出した値）で包む。** `useReducedMotionConfig()` は MotionConfig が無いと**常に false** を返します（既定は `"never"`）。**CSS の `@media (prefers-reduced-motion)` は JS アニメーションを止めないので、「対応済み」に見えるのが最悪の点です。**
  - **手本は kanji_town です**（`src/App.jsx:2` で `MotionConfig` を import、`:203` で `shouldReduceMotion(motionPreference, systemPrefersReducedMotion)`、`:843` で `<MotionConfig reducedMotion={isReducedMotion ? 'always' : 'never'}>`。Confetti / WeatherOverlay / VillagerDot / AnimatedCounter / ReadMode がいずれも `useReducedMotionConfig()` を使用）。**この配線を「整理」で崩さないこと。**
- **結果・正誤・トーストには `role="status"` / `aria-live`。エラーだけ `role="alert"` + `aria-live="assertive"`。二重に書かない。** 自前コードの live region が 0 件なのは word_basket と ice_slide-puzzle（唯一のヒットは vendor の sweetalert2）。「時間切れで場札が変わった」が伝わらないまま次の操作に進み、何が起きたか分からないまま負けます。
- **児童に見せるエラーは「何が起きたか」ではなく「次に何をすればいいか」。** サーバーやライブラリの `e.message` をそのまま画面に出さない。最後は「それでも だめなら、せんせいに つたえる」で終える。悪い例: `townmap_mikke/App.html:2825,2847,3297`。良い例: `gamification/manabi-quest/js_core.html:35`「サーバーから 返事が ありませんでした。つうしんを たしかめて、もういちど ためしてね。」
- **児童が押せるボタンで、条件を満たさないときに何も起こさず return しない。** `mirai-compass/js_student.html:107` は名前が空だと `if (!name) return;` で無反応（quoridor が「出せないボタンを置いておくと『押しても何も起きない』と言われる」と同じ教訓を残しています）。
- **設定画面にトグルを足したら、その値を読んでいる箇所を grep で示すまで完了にしない。** kanji_town の「ふりがなを表示」は押すとスイッチが動き localStorage にも保存されますが、`FormatKun` が settings を受け取っていないので**表示は一切変わりません**（`grep -rn showFurigana` が設定画面の 3 行のみ）。同じ画面の autoPlay・readingCheck は正しく配線されているので、動かないのはこの 1 つだけ＝最も気づきにくい。しかも `kanji_town/MANUAL.md:154` が**その動かない機能の使い方を先生に説明しています**。

### 7-3. 共用端末（教室のタブレットは次の子が使う）

- **児童を特定する値（名前・出席番号）を保存する画面では、保存チェックの既定を OFF にし、いま誰として使っているかを常時表示し、「べつの人がつかう」を 1 タップの場所に置く。** `mirai-compass/js_student.html:55` は `checked` で出荷され、児童側のログアウト導線が repo 全体に **0 件**。次の子が開くと前の子として自動ログインし、その子の名前で書き込みまでできます。ラベル「情報を保存する」では小 3 に意味が伝わりません。
- **`study.records.v1` は「きろくを けす」で消さない**（他アプリの未送信分まで消える）。**同時に、前の子の未送信ログが次の子の名前で送られない導線も確認する**。片方だけ守ると事故の向きが変わるだけ。匿名エンドポイント運用時、ポータルは端末に保存された出席番号で確認なしに自動送信します＝**A さんの練習が B さんの出席番号で先生に届く。**
- **提示モードで名前を伏せるときは、DOM に渡す文字列そのものを伏せ字にする。** `color: transparent` / opacity / blur / filter を使わない（`mirai-compass/css.html:916-921` が該当）。forced-colors はブラウザが color を強制上書きするので無効化され、**弱視の教員がハイコントラストを入れているまさにその教室の電子黒板に、名前が全部出ます。** 手本は `qalc/src/presentation.jsx:83-97 maskPupilName`。
- **localStorage のキーには必ずアプリ固有の接頭辞。** とくに GAS は全アプリで同一オリジン（googleusercontent.com）を共有するので、`isTeacher` `studentId` のような一般名を新設しない（現存: moral_note, schoolplan_editor, sekigaemaker）。道徳ノートで教員として入ったあと別の GAS アプリでも教員扱いになる、という追跡不能な事故になります。

---

## 8. 時間・保存データ・白画面

### 8-1. 時間は「刻む」のではなく「締切から引く」

- **悪い形:** `blackboard_timer/timer.js:112-119` は `setInterval(…, 1000)` の中で `timeRemaining--` しています。README は「タブを切り替えても消えません」と謳っていますが、tick を数える実装なので背景化・スロットリング・端末の負荷でそのまま実時間からずれます。
- **手本:** `kake_master/js/app.js:493-496`（`performance.now() - quiz.t0`）、`kake_master/js/studySession.js:76-93`（`activeMs += Date.now() - mark;` ＋ `visibilitychange` ＋ 60 秒無操作停止）。
- **壊れ方:** 漢字テストの「5 分」を電子黒板に映す。実際には 6 分半経っている、あるいは端末ごとに違う。テストの条件が児童によって変わる。
- **「今日」を UTC で作らない。** `digitalcloset/src/App.jsx:1193` は `new Date().toISOString().split('T')[0]` を「今日」として、ローカル時刻で組んだ文字列と比較しています。**JST の 0:00〜9:00 は前日になります**＝朝の会（8 時台）の記録が前日分に入る。手本と理由コメントは `homework_barcordreader/src/App.jsx:178-190`（`getLocalDateString` ＋「`new Date('YYYY-MM-DD')` はUTC深夜として解釈され日付がずれる」）。

### 8-2. 保存キーを変えるなら移行も同じ PR で

- 保存形式の版と移行コードを持つのは **3 本だけ**: `reflection_journal/Main.gs:26 SCHEMA_VERSION: 2`、`homework_barcordreader/src/App.jsx:2281`（`hp_schema_version` ＋ `migrateData`）、`kanji_town/src/systems/storage.js:44-46`（`STORAGE_KEY = 'kanji_town_v7'` ＋ `LEGACY_KEYS = ['…v6','…v5']`）。
- `typa.progress.v1` / `giga_calc_records_v4` のようにキー名に版が埋まっているものは、**キーを 1 文字変えた瞬間に過去のデータが「無い」ことになります**（消えるのではなく読まれなくなるので、エラーも出ない）。
- **壊れ方:** 漢字タウンの保存形式を整理して `kanji_town_v8` にする。児童が半年かけて育てた村が、次に開いた瞬間に初期状態になる。
- **規律:** 保存キーを変える／保存オブジェクトの形を変えるときは、旧キー・旧形からの読み取り（LEGACY_KEYS 相当）を同じ PR で入れ、「旧データを読んで新形に直せる」テストを 1 件書く。書けないなら形を変えない。

### 8-3. 真っ白と、版を聞ける場所

- **ErrorBoundary を持つのは 3 本だけ**（quarto / homework_barcordreader / kanji_town）。vite の React アプリは 12 本あるので、残りは描画中の例外がそのまま白画面です。
- 起動失敗そのものを検出して児童に道を示すのは **`quoridor/public/boot-check.js` の 1 本だけ**。冒頭コメントがそのまま規律になっています:
  > 本体（React）が動かなかった場合、body には何も無いので画面は真っ白になり、児童からは「こわれた」としか見えず、直す手立てが画面上に一つも無い。ここは本体とは別のファイルなので、本体が読めない・落ちた場合でも動く。
  > ⚠️ 直すボタンが消すのは `kabe-kabe-` で始まるキャッシュだけにする。
- **SW でシェルが焼き付くこの構成では、白画面は配り直しでも直りません。** SW を持つ React アプリを触ったら、ErrorBoundary を root に置く／別ファイルの番人があるかを確認する。
- **版とビルド識別子を画面のどこかに出す。** これをやっているのは kanji_town だけです（`SystemStatusPanel.jsx:114` と `SettingsView.jsx:383` が `v{APP_VERSION} · {BUILD_COMMIT.slice(0,8)}`）。**先生に「いまお使いの版は何番ですか」と聞ける画面が 1 本しか無いから、「直したはずなのに直らない」の切り分けが結局また推測になります。**

---

## 9. 正本（standards/）を触るとき

- **正本とコピーを同時に直すときは、正本の PR を先にマージして main に入ったことを確認してから、コピー側の PR を出す。** 各リポジトリの drift ジョブは `actions/checkout` に `ref:` を書いていないので、**常に GIGAyama.github.io の main** と照合します。同時に開くとコピー側 drift が必ず赤になり、standards を参照している 27 リポジトリの main が同時に赤くなります。
- **正本の写しを 1 本でも触ったら、`standards-map.json` に載っているか確認し、無ければ同じ PR で載せる。** map 自体が無いのは digitalcloset / quarto / app_launcher / xxx_automatic の 4 本。reversi / quoridor / schoolplan_editor / online-100square / mirai-compass は **map を持っています**（別ファイルだけ登録）ので、上書き新規作成しないこと。
- **`standards/` を直したら、同じ PR で `standards/**/*.test.mjs` にその挙動のテストを足す。** テストが無い正本は `check-drift.mjs` / `sw/build-sw-static.mjs` / `sw/build-sw-vite.mjs` / `records/records-hub-client.js` / `lib/run-giga-checks.mjs`。standards-ci.yml はこれらを `node --check`（構文が読めるか）しか通していません。
  - **壊れ方:** check-drift が誤って「一致」と判定するようになると、27 本の drift が一斉に緑のまま何も言わなくなる。build-sw が退行すると 14 本の PWA が同時に更新不能になり、各リポジトリの CI は `--check` が「ずれていません」と言うので全部緑。
- **`standards/records/records-export.test.mjs` は正本の場所では動きません**（`:8` の `import … from '../js/records-export.js'` で ERR_MODULE_NOT_FOUND）。records 系を触る前に `./records-export.js` に直し、standards-ci.yml に `node --test standards/records/*.test.mjs` を足すこと。
- **`scripts/lib/project-quality.mjs` を「全リポジトリ共通の正本」と新しく書かないこと。** 8 本がコピーを持ち複数の README がそう書いていますが、`standards/lib/` に実体はありません（6 本が md5 `494844c7`、omp-lite は 158 行、shiritori_fighter は 64 行の別物）。触るなら「standards に置く／廃止する」をまず決める。
- **Pages から GAS を呼ぶコードを直すときは `standards/web/giga-gas-client.js` を採用する。** 採用しないなら同じ 19 ケース（`/dev` の拒否、text/plain 固定、redirect: follow、no-cors 不使用、`{ok:false}` の例外化、ログイン HTML の判別、500 の再試行と 403 の即断念、時間切れ）を自前でテストする。**現在採用しているリポジトリは 0 本**で、5 か所すべて自前実装＋テスト無しです。「Content-Type を application/json にするとプリフライトで必ず失敗する」といった一発全滅の落とし穴が既にテストとして書かれているのに、その知見がどこにも効いていません。

---

## 10. 生成物・並行作業・文書

- **生成物（dist/ docs/ vendor/ sw.js）をコミットしているリポジトリで原本を直したら、コミット前に必ずビルドを走らせて `git status` と `git diff` を目で見る。** 意図した部分だけを add する。
  - xxx_automatic は docs/ 配下 188 ファイルをコミットし、Pages 配信は `paths: docs/**` でしか起動しません。**scripts/ だけ直して docs/ を作り直し忘れると、ワークフローは緑どころか一度も走らず、サイトは永久に古いまま。** 逆に何も考えずビルドすると `docs/launcher.json` の `notes` 配列（note 記事の下書き情報）が丸ごと消えます（実測: 8 insertions / 35 deletions）。
- **cron で動くワークフローを持つリポジトリは、最初に直近 run の conclusion を確認する。** scheduled の失敗は誰にも通知されず、PR も赤いチェックも出ません。xxx_automatic の週次生成は 2026-08-16 から止まっており、配信中の `docs/launcher.json` は 2026-08-09 生成のままです。
- **生成物をコミットして配信するリポジトリは、CI で「ビルドし直して `git diff --exit-code`」を通す。生成物を直接編集しない。** 手本: `omp-lite/.github/workflows/ci.yml:23`、`kana_master/tools/check-project.mjs:303 BUILD_IS_FRESH`、`keisan-card` の `build.mjs --check`。
- **Dependabot の PR は、standards-map.json に載っているファイルを触っていないか diff を見てからマージする。** 現状 `actions/checkout` が v4=101 / v5=1 / v7=26 と混在し、schoolplan_editor の deploy.yml は正本と checkout のバージョンも `GAS_DEPLOYMENT_IDS` 対応も違うのに、未登録なので drift が検知しません。
- **画面の文言・ボタン・設定項目を変えたら、文書のヒットを確認して PR 本文に貼る**（ヒットゼロも貼る）:

```bash
grep -rn "<変えた文言>" MANUAL.md README.md docs/note/ /home/user/GIGAyama.github.io/apps/<slug>/ 2>/dev/null
```

  MANUAL.md は 33 本、`docs/note/` の画面写真は 717 枚、ポータルの紹介ページは 32 ページあります。**先生は MANUAL のとおりに操作して、そのボタンが無いところで止まります。授業直前の準備で詰まったアプリは、二度と開かれません。**
- **リポジトリを触ったら CLAUDE.md に書き残す**（作業前の fetch とブランチ作り直し／push 前の再 fetch／そのリポジトリ固有の反映経路が §0-4 の 4 経路のどれか）。無ければ作る。**現在 CLAUDE.md があるのは werewolf と xxx_automatic の 2 本だけで、git 運用の手順書は正本 docs にも 1 本もありません。** だから次のセッションが同じブランチを再利用し、同じ SW 版を上げ忘れ、同じ「マージ＝反映」の勘違いをする。それが 39 リポジトリぶん積み上がっています。

---

## 11. 報告のしかた（GIGAyama さんは 1 人で 43 本を保守している）

- **「ゲート通りました」と書くときは、実際のコマンドと exit code と出力の最後の 3 行を貼ること。** 「〜が無いため走っていません」を含む出力は貼れば必ずバレるので、**貼れないなら合格ではありません**。
- **測っていないものは「未計測」と書く。チェックを付けない。**（`typa/AUDIT.md:10-12`）
- **直せなかったこと・見つけたが手を付けなかった穴は、憶測を混ぜずにファイルと行番号で列挙して報告する。** §0-1 で「任意」に回した付帯工事も、ここに「次の入口」として書く。黙って残すより価値があります。

---

## 終わる前に必ず確かめること

**A. 範囲**
- [ ] 1 リポジトリ・1 PR・1 目的に収まっている。ついでの整理を混ぜていない
- [ ] AUDIT.md / README.md の「見送り」「入れない判断」を踏み潰していない
- [ ] 「任意」に回した付帯工事を PR 本文に「次の入口」として書いた

**B. 動かして確かめた**
- [ ] `git fetch origin` してから `git log --oneline HEAD..$DEF` が空
- [ ] ビルド成果物を見る検査があるなら `npm run build && npm run check` の順で実走した
- [ ] `npm run check` の出力に「走っていません」「未取得」「dist が無い」の行が 1 行も無い
- [ ] self-test を実走し、**失敗件数が作業前から増えていない**（もともと落ちている分は列挙して残した）
- [ ] 対象リポジトリ直下で `node /home/user/GIGAyama.github.io/standards/check-drift.mjs --standards /home/user/GIGAyama.github.io/standards` を実行し、`✅ 正本と一致しています（N ファイル）` が出て **N が期待どおり**（「持ちません」は緑ではない）

**C. 配信が本当に届く**
- [ ] 配信物を変えたなら SW の版が変わっている（`git diff` で確認。自動採番なら `node tools/build-sw.mjs --check` が通る）
- [ ] **反映経路を確定した**（Pages / GAS / Chrome ウェブストア / Netlify）。拡張なら `manifest.json` の `version` を上げた
- [ ] `offline.html` に `<script>` も `onclick=` も無く（コメント本文は除く）、`<a href="./">` がある
- [ ] manifest の `id`/`scope`/`start_url` が `./` 系のまま
- [ ] 新規に読み込んだ外部ホストがゼロ

**D. データが失われない**
- [ ] records 系を触ったなら 5 点を目で確認し、PR 本文に「本番疎通は未確認」と書いた
- [ ] `appId` を変えたなら 4 か所が揃い、GAS を再デプロイした
- [ ] **`schema` 文字列とレコードの形を変えていない**（変えたならハブ・GAS・9 アプリを揃え、経過措置を入れた）
- [ ] 保存キー／保存オブジェクトの形を変えたなら、旧形からの移行とそのテストがある

**E. GAS**
- [ ] `.gs` の公開関数（末尾 `_` 無し）を数え上げ、新設したものすべてに認可がある
- [ ] `appsscript.json` が存在し（gamification は `manabi-quest/` 配下）、webapp と oauthScopes を差分で確認した（スコープを広げていない）
- [ ] 一斉に叩かれる書き込みが LockService で囲まれている。ポーリングを足したなら非表示タブで止まる
- [ ] 本番反映を確認した（run の所要時間と各ステップの conclusion が skipped でない）

**F. AI・個人情報**
- [ ] AI へ渡す引数がすべて仮名化関数の戻り値
- [ ] API キーが URL クエリに入っていない、ログに本文・応答・キーが出ていない
- [ ] `privacy.html` の記述が実装と一致している

**G. 教室で使える**
- [ ] 拡大を止めていない、`rt` の色を色面に決め打ちしていない、`<rp>` がある、`<html lang="ja">` がある
- [ ] `outline:none` を書いたなら代替と forced-colors の手当てがある
- [ ] 追加した設定トグルを読んでいる箇所を grep で示せる
- [ ] 児童に出るエラー文が「次に何をすればいいか」で終わっている／押しても何も起きないボタンを作っていない
- [ ] 時間は締切から引いている、「今日」を UTC で作っていない
- [ ] タップ目標・コントラスト・ms は**測ったか「未計測」と書いたかのどちらか**

**H. 残すもの**
- [ ] 例外を足したなら、**そのリポジトリの検査器が読むキー**に書き、理由を添えた
- [ ] 文言・ボタン・設定を変えたなら MANUAL / README / note / ポータルの grep 結果を貼った
- [ ] CLAUDE.md に、このリポジトリの反映経路と注意を書き足した
- [ ] PR 本文に、実行したコマンド・exit code・出力末尾 3 行・**直さなかった穴の一覧**を書いた