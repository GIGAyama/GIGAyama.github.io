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

---

## 6. AI開発エージェント（Antigravity / Claude Code）の行動指針

本リポジトリまたは傘下のアプリ群で作業するAIエージェントは、以下の手順を遵守してください。

1. **コード追加・修正時**:
   - 外部CDN（スクリプト・スタイル・フォント）を絶対に追加しない。
   - 児童の個人情報を扱うコードを書かない（Local First）。
   - タッチボタンは `min-height: 48px`, `min-width: 48px` を確保し、学年別配当漢字には `<ruby>` を付与する。
2. **共通コード・モジュール修正時**:
   - 個別リポジトリ側のコピーを直接書き換えない。**必ず `GIGAyama.github.io/standards/` の正本を修正**し、`distribute.mjs` を通じて配布する。
3. **コミット・PR作成前**:
   - 必ず `npm test` または `node --test` を実行。
   - `node tools/build-sw.mjs --check` で SW 版数の一致を確認。
   - `node standards/check-drift.mjs` で正本との整合性を確認。
