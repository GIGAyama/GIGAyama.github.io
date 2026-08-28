# GIGAスクール Webアプリケーション群 マスターアーキテクチャ仕様書 (SYSTEM MASTER)

本ドキュメントは、`GIGAyama`（giga-school.com）における40以上の教育用Webアプリケーション群、旗艦ポータル、共通正本同期システム、およびGitHub Actions自動化パイプラインの**全体設計・運用思想・障害教訓を網羅した最高位のマスター仕様書（引き継ぎ書）**です。

人間だけでなく、**Antigravity（Gemini）および Claude Code のAI開発エージェントが、本システムのリードエンジニアと同等の高次元な文脈を瞬時にロードし、逸脱のない自律開発を行うための正本コンテキスト**として機能します。

---

## 1. システムミッションと基本思想 (Mission & Principles)

### 1.1 ミッション
- **公立小学校の教育現場におけるICT活用の最大化**: 児童が直感的に使え、教員が授業で即座に活用できるWebアプリを無償・高品質で提供する。
- **自律的・持続可能な運用（運用コスト月0円）**: GitHub Pages、GitHub Actions、GitHub Issues、Gemini API等の無料枠を極限まで活用し、インフラ維持費0円で完全自律稼働させる。

### 1.2 3大絶対設計原則 (Core Invariants)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             3大絶対設計原則                                   │
├──────────────────────────┬──────────────────────────┬───────────────────────┤
│ 1. Zero External CDN     │ 2. Zero PII              │ 3. Local First &      │
│    (外部CDNゼロ・自己完結)│    (個人情報ゼロトラスト) │    Deterministic SW   │
├──────────────────────────┼──────────────────────────┼───────────────────────┤
│ ・学校フィルタリング対策 │ ・児童の氏名・番号・写真 │ ・学習ログはブラウザ内│
│ ・オフライン完全動作     │   を一切入力・保存しない │   (IndexedDB/Storage) │
│ ・外部ホスト依存を根絶   │ ・暗号化ID・匿名化の徹底 │ ・SWキャッシュ版数は  │
│ ・全アセットをバンドル   │ ・外部サーバー送信禁止   │   成果物から自動算出  │
└──────────────────────────┴──────────────────────────┴───────────────────────┘
```

1. **Zero External CDN（完全自己完結）**:
   - 学校現場のネットワークは `i-FILTER` などの強固なフィルタリングや、時に不安定な回線環境にあります。
   - `cdnjs`, `unpkg`, `Google Fonts`, `jsdelivr` 等の外部CDNからのランタイム読み込みは**原則禁止**。
   - ライブラリ、フォント、アイコン、スタイルはすべてビルド時にバンドルするか、リポジトリ内に静的配置します。
2. **Zero PII（個人情報ゼロトラスト）**:
   - 児童の氏名、出席番号、顔写真、学級名などの個人特定可能情報（PII）は**絶対にコード・ログ・通信に含めない**。
   - 学習履歴やスコアはブラウザ内（localStorage / IndexedDB）で完結させ、外部データベースへの送信は行いません。
3. **Local First & Deterministic SW（決定論的PWA版管理）**:
   - 児童が一度開いたアプリは、オフラインでも完全に動作するPWA（Progressive Web App）として構築。
   - Service Worker（`sw.js`）のキャッシュ名・版数は、人手で更新するのではなく、**ファイルの中身のハッシュから自動生成**し、版ずれ・キャッシュ事故を防止します。

---

## 2. 全体アーキテクチャとデータフロー (System Topology)

```mermaid
graph TD
    subgraph Flagship ["旗艦ポータル: GIGAyama.github.io (giga-school.com)"]
        Standards["standards/ (正本・Single Source of Truth)<br/>├── sw/ (SW版数自動生成スクリプト)<br/>├── lib/ (品質ゲート・検査モジュール)<br/>├── records/ (学習ログ study.v1 規格)<br/>├── web/ (giga-sw-updater 等のUIモジュール)<br/>└── skills/ (Antigravity / Claude Code 共通スキル)"]
        DistTool["tools/distribute.mjs<br/>(正本自動配布・PR自動マージ)"]
        CheckDist["tools/check-distribution.mjs<br/>(逆向き常時同期監視)"]
        SyncTool["tools/sync-updates.mjs<br/>tools/build-articles.mjs<br/>tools/build-devlog.mjs"]
        PortalApp["ポータル本体<br/>(index.html / /apps/ / /devlog/ / sitemap)"]
    end

    subgraph AppRepos ["各Webアプリ群 (42+ Repositories)"]
        AppCode["アプリ本体 (Vanilla JS / Vite / GAS)"]
        StandardsMap["standards-map.json (正本対応定義)"]
        LocalCI[".github/workflows/ci.yml<br/>(check-drift.mjs & build-sw --check)"]
        NoteDocs["docs/note/note-article.md<br/>docs/devlog/*.md"]
    end

    subgraph SocialAuto ["SNS・プロモーション自動化: XXX_automatic"]
        Launcher["投稿ランチャー (PWA + GitHub Issues)"]
        GenWorkflow["Gemini API 連携ワークフロー<br/>(X・note 投稿草案自動生成)"]
    end

    %% 正本の配布と監視
    Standards -->|standards/ 更新時 (auto-distribute.yml)| DistTool
    DistTool -->|一括クローン & PR自動マージ| AppRepos
    CheckDist -.->|毎朝 逆向き検査 (check-distribution.yml)| AppRepos
    LocalCI -->|PR/Push時に正本と突合| Standards

    %% 記事・更新情報の集約
    NoteDocs -->|毎朝 自動取得 (sync-updates.yml)| SyncTool
    SyncTool -->|静的HTML・インデックス生成| PortalApp

    %% プロモーション連携
    AppCode -->|README・MANUAL収集| GenWorkflow
    GenWorkflow -->|朝夜の投稿案内| Launcher
```

---

## 3. 正本（Canonical）同期アーキテクチャ

各アプリは「自己完結」で動作する必要があるため、共通コードを npm パッケージ等で実行時ロードするのではなく、**「正本をローカルにコピー配置し、差分（ドリフト）をCIで機械的に監視する」** アプローチを採用しています。

### 3.1 正本管理の仕組み
- **正本の置き場**: `GIGAyama.github.io/standards/`
- **配布台帳**: `GIGAyama.github.io/tools/distribution.json`
  - `targets`: コード正本を配る先（Vite系、静的HTML系、GAS系など約32リポジトリ）
  - `skills.extra`: コードは持たないが開発スキルを配る先（約10リポジトリ）
  - `excluded`: 配布対象外（理由が必須）
- **アプリ側マッピング**: 各リポジトリ直下の `standards-map.json`
  ```json
  {
    "files": [
      { "canonical": "sw/build-sw-static.mjs", "local": "tools/build-sw.mjs" },
      { "canonical": "lib/giga-v5-checks.mjs", "local": "scripts/lib/giga-v5-checks.mjs" }
    ],
    "dirs": [
      { "canonical": "skills/devlog-article", "local": ".claude/skills/devlog-article" },
      { "canonical": "skills/note-article",   "local": ".claude/skills/note-article" }
    ]
  }
  ```

### 3.2 同期・検証の自動化ロジック
1. **配布先でのドリフト検知（Pull側検知）**:
   - 各アプリの CI（`ci.yml`）で `GIGAyama.github.io` をチェックアウトし、`check-drift.mjs` を実行。正本と1文字でも乖離があればCIが赤になり、個別リポジトリでの無断改変を阻止。
2. **正本側からの自動配布（Push側同期）**:
   - `GIGAyama.github.io` の `standards/` が更新されると、`auto-distribute.yml` が発火。
   - `tools/distribute.mjs` が全リポジトリを走査し、ブランチ作成・コミット・PR発行・自動マージ（`gh pr merge`）を一括実行。
   - ⚠️ **この経路は `PAT_TOKEN`（リポジトリをまたげるトークン）が無いと 1 本も配れません。**
     Actions 既定の `GITHUB_TOKEN` は自分のリポジトリにしか書けないため、
     他の 42 本への push はすべて 403 になります。設定手順と期限切れ時の対処は
     [`docs/operations/pat-token.md`](../operations/pat-token.md) を参照。
   - `normalize`（配布先ごとに変えてよい場所）が宣言されているファイルは、
     正規化したうえで一致していれば上書きしません。ここを見ないと、
     配布先が入れた値（`APP_ID` など）が配布のたびに消えます。
3. **正本側からの逆向き監視（漏れ検知）**:
   - `check-distribution.yml` が毎朝定期実行され、全配布先のリポジトリが正本と完全一致しているかを逆向きに監査。

---

## 4. 記事・更新情報の自動ビルドパイプライン (`sync-updates.yml`)

毎朝（日本時間 6:17）または手動トリガーで起動し、ポータルサイトの鮮度を完全自動で保ちます。

```
[sync-updates.yml の実行フロー]
1. node tools/sync-updates.mjs --fetch
   └── GitHub API で各アプリの最新コミット日・タグを取得 → data/apps.json を更新
2. node tools/build-devlog.mjs
   └── 各アプリの docs/devlog/*.md を取得 → /devlog/ 配下に静的HTMLをビルド
3. node tools/build-articles.mjs
   └── 各アプリの note 記事 (note-article.md) を取得 → /apps/<slug>/ に紹介ページをビルド
4. node tools/sync-updates.mjs
   └── sitemap.xml, feed.xml, search-index.json, カテゴリ別入口ページを再構築
5. 整合性・安全検査
   ├── tools/check-cards.mjs (カードの data-slug とリンク先の整合性検査)
   ├── tools/check-404-redirect.mjs (旧URL受け皿の転送ルール検査)
   └── tools/build-sw.mjs --check (ポータル自身のSW版数更新と検証)
6. 差分コミット & プッシュ
   └── 変更があった場合のみ github-actions[bot] が自動コミット
```

---

## 5. 過去の重大障害履歴と設計の教訓 (Lessons Learned)

本システムは、過去に発生した実際のインシデントに対する再発防止策として進化してきました。改修時は以下の教訓を絶対に忘れてはなりません。

| 発生日 | 事象・インシデント | 原因 | 確立された恒久対策・ルール |
| :--- | :--- | :--- | :--- |
| **2026-08-21** | SWのキャッシュ版数上げ忘れ事故 | 手動で版数を管理していたため、コード更新後に古いキャッシュが児童端末に残り続けた。 | ビルド対象ファイル群の内容ハッシュからSW版数を自動算出するスクリプト（`build-sw-*.mjs`）を正本化。CIで `--check` を義務化。 |
| **2026-08-22** | 正本修正後の配布忘れによる10リポジトリ一斉CI赤落ち | 正本を修正したが、配布先へのコピーを手動で行っていたため同期漏れが発生。 | `distribute.mjs` による完全自動PRマージ機構、および `check-distribution.mjs` による逆向き監視を新設。 |
| **2026-08-24** | Quarto紹介ページの画像リンク切れ（mainが赤化） | Viteアプリで `dist/` のみを配信しており、`docs/note/images/` がサブドメイン側から読めなかった。 | `build-articles.mjs` 内で画像URLに対して実際にHEADリクエストを送り、到達不能なら `raw.githubusercontent.com` へ自動フォールバックする動的判定を導入。 |
| **2026-08-25** | GITHUB_TOKENの仕様によるCI未発火問題 | Actions内で `GITHUB_TOKEN` を使ってpushすると、後続のワークフローが起動しない仕様により、検査漏れが発生。 | ワークフロー内でコミット前に `build-sw.mjs --check` などの検査をインラインで完結させる設計に改修。 |
| **2026-08-28** | `.agents/` が正本照合の外にあり、配布物の半分が無検査だった | Antigravity 対応で全リポジトリへ `.agents/` を配ったが、`check-drift.mjs` は `.claude/skills/` しか見ていなかった。`.agents/skills/` は書き替えても、見知らぬスキルを置いても緑のまま通った（Typa で実測）。 | 置き場を `SKILL_ROOTS` に集約し、`.claude/` と `.agents/` の両方を照合。`standards-map.json` へ置き場ごとに 1 行ずつ登録する（片方だけだともう片方が無検査になる）。 |
| **2026-08-28** | `giga-reviewer` が Windows で一度も動いていなかった | CLI の入口判定が `` `file://${process.argv[1]}` `` を文字列で組み立てて `import.meta.url` と比較していた。Windows は `file:///C:/…`（スラッシュ3本）、空白や日本語は百分率符号化されるため一致せず、**何も検査せず exit 0** で「合格」に見えていた。 | `pathToFileURL()` で比較。空白を含むパスから実際に起動して exit 1 になることをテストで固定（古い実装に戻すと落ちる）。 |
| **2026-08-28** | 学習記録が 9 本のアプリで 1 件も届いていなかった | 受け渡し口の `APP_ID` が正本のプレースホルダー `'__APP_ID__'` のまま公開されていた。ポータルの `RECORD_SOURCES` と appId が一致せず、配備済みでも記録が届かない。`distribute.mjs` が `normalize` を見ずに上書きするため、配布先で直しても次の配布で必ず戻っていた。 | 配る側が `normalize` を見るよう修正（正規化して一致するなら上書きしない）。9 本に正しい appId を設定。`Gamification` の `check-bridges.mjs` が本番を叩いてこの形を検知する。 |
| **2026-08-28** | `auto-distribute` が一度も成立せず、42 本の 403 で終わっていた | ワークフローが `secrets.PAT_TOKEN \|\| secrets.GITHUB_TOKEN` と書かれ、`PAT_TOKEN` 未設定時に**原理的に成功しえない** `GITHUB_TOKEN` へ落ちていた。42 本ぶんの 403 のどこにも原因が書かれない。 | 先頭で `PAT_TOKEN` の有無を検査し、無ければ理由を出して停止。手順は [`docs/operations/pat-token.md`](../operations/pat-token.md)。 |
| **2026-08-28** | 記事の画面写真の検査が main を止め続けていた | 11 本の記事に `.sources.json`（元の指紋）が無く、比べる相手が存在しないため画像 230 枚が毎回「差しかわった」と数えられていた。実際に違ったのは 9 枚。`--check` しか自動実行されないため自然には直らない。 | `build-article-images.py` を実行して指紋を生成。**この検査は自動では復旧しない**ので、赤くなったら人が作り直す。 |
| **2026-08-28** | Google Fonts の `text=` が、約 800 字で**エラーにならずに**効かなくなる | 字を絞って取り寄せる API は、`text=` が長すぎると HTTP 200 のまま、絞っていない 122 面ぶんの CSS を返す（800字/6,581B は 1 面、806字/6,635B で 122 面）。最初の面だけを採ると 1KB ほどの狭いフォントが書き出され、画面のほとんどが端末フォントに落ちるが、**ビルドは成功したように見える**。 | 字を束（既定 780 字）に割り、1 リクエスト＝1 面であることを毎回確かめる（`assertSingleFace`）。設定で 800 を超える束を書けないようにする。 |
| **2026-08-28** | 正本へ足したものを、コミットする前に配布先へ写した | 手元では正本も写しも新しいので `check-drift` が通る。マージすると**正本だけが古いまま**残り、12 本で再生成が落ちる形になった（#98 → #99）。 | **正本をコミットしてから配布先へ写す。** 順番を逆にすると、手元の緑は何も保証しない。 |
| **2026-08-28** | 収録する字にコメントの漢字まで数えていた | ソースから「画面に出る字」を拾うとき、日本語コメントの字も混ざっていた。MIRAI-Compass では 1,263 字のうち 842 字がコメントにしか出てこない字で、GAS へ埋めこむ CSS が 589KB になっていた（「妥協」「崩壊」「喧嘩」「梱包」「冪」など）。 | `stripComments` を通してから拾う（589KB → 88KB）。⚠️ 行の途中から始まる `//` は落とさない。`https://…` で行を切ると、その行にある**画面に出る文字列まで消える**。 |
| **2026-08-28** | 静的検査が「合格」と言い、ブラウザは外を読んでいた（3 件） | ①スキームを省いた `//cdn.jsdelivr.net/…` を `https?://` でしか見ていなかった ②`<img src>` を見ておらず、「先生の合図を待ってね」の絵を外部 CDN から取っていた ③印刷ウィンドウの中から `@import` していた。**どれも静的検査では 0 件だった。** | 実ブラウザに読ませて**通信を記録して**見つけた。`giga-reviewer` の 2 つの穴は正本で塞ぎ、落ちることを試験で固定。**検査が「0 件」と言っても、実際に開いて通信を見るまで信じないこと。** |
| **2026-08-28** | 中身を原本へ移したら、検査が**見るものを失って緑になった**（4 か所） | JSX と CSS を `index.html` から `src/app.jsx` へ移したとき、検査側は元の場所を決め打ちで見ていた。Reflection_Journal の G10 は `['app','css','vendor','qr']` の 4 つ決め打ちで、足した `fonts.html` を見ないまま「4 ファイルに `<?` なし」と緑を出した。Townmap_Mikke の JSX 構文検査は見る対象が消えて空振りした。 | 検査する一覧を**入口のファイル自身から読む**（`include_()` の名前を拾う、`targets` から読む、`entrySources` を設定に持つ）。決め打ちの一覧は「足したものだけが検査されない」という、いちばん気づけない壊れ方をする。 |

---

## 6. AI開発エージェント（Antigravity / Claude Code）の行動指針

本リポジトリまたは傘下のアプリ群で作業するAIエージェントは、以下の手順を遵守してください。

1. **コード追加・修正時**:
   - 外部CDN（スクリプト・スタイル・フォント）を絶対に追加しない。
   - 児童の個人情報を扱うコードを書かない（Local First）。
   - タッチボタンは `min-height: 48px`, `min-width: 48px` を確保し、学年別配当漢字には `<ruby>` を付与する。
2. **共通コード・モジュール修正時**:
   - 個別リポジトリ側のコピーを直接書き換えない。**必ず `GIGAyama.github.io/standards/` の正本を修正**し、`distribute.mjs` を通じて配布する。
3. **コミット・PR作成前**（**そのリポジトリに在るものだけ**を走らせる）:
   - `npm test` または `node --test`（`scripts.test` があるリポジトリ）。
     ⚠️ ポータル（`GIGAyama.github.io`）に `package.json` は無い。テストは
     `.github/workflows/standards-ci.yml` と同じ並びを直接叩く。
   - `npm run check`（`scripts.check` があるリポジトリ）。
   - `node tools/build-sw.mjs --check`（`tools/build-sw.mjs` があるリポジトリのみ）。
   - 正本との整合性:
     ⚠️ **配布先に `standards/` は無い**。`node standards/check-drift.mjs` は
     配布先では必ず ENOENT で落ちる。また `--standards` は必須（省くと exit 2）。
     - 配布先: `node ../GIGAyama.github.io/standards/check-drift.mjs --standards ../GIGAyama.github.io/standards`
     - ポータル: `node standards/check-drift.mjs --standards standards`
