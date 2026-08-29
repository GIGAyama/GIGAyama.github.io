# GIGAyama.github.io — Claude Code 開発ガイド

@.agents/rules/gigaschool-standards.md

本リポジトリは、GIGAスクールWebアプリ群（giga-school.com）の旗艦ポータル兼共通コードの正本（Single Source of Truth）です。

⚠️ **上の 1 行を消さないこと。** 艦隊共通のルール（Zero-CDN・Zero-PII・正本同期）は
`standards/agents/rules/gigaschool-standards.md` に 1 本だけ置いてあり、
Claude Code はこの取りこみを通して読む。以下はポータル固有の話だけを書く。

## マスター仕様書
本システムの全体像、アーキテクチャ、データフロー、障害教訓については、以下を参照してください：
- [SYSTEM_MASTER.md](docs/architecture/SYSTEM_MASTER.md)

## 運用の手順書
- [PAT_TOKEN の設定と更新](docs/operations/pat-token.md) — 正本の自動配布が
  42 本まとめて 403 で落ちたら、まずここを読む（トークンの未設定か期限切れ）

## 開発・改修時の最重要ルール
1. **Zero External CDN**: 外部CDN（unpkg, cdnjs, Google Fonts等）のランタイム読み込み禁止。
   自己ホストの道具は正本にある。書体は `standards/fonts/`（GAS 向けの `data:` URI 埋めこみ
   `embed: true` も持つ）、ライブラリとアイコンは `standards/vendor/`。
   **アイコンは webfont を取りこまない。使っている分の SVG だけを `mask-image` にする**
   （bootstrap-icons 丸ごと 229KB → 使用分 10〜35KB）。
   ⚠️ **静的検査が「0 件」でも信じないこと。** 2026-08-28、スキームを省いた `//cdn…`、
   `<img src>`、印刷ウィンドウの中の `@import` の 3 件が検査を素通りしていた。
   どれも実ブラウザに読ませて通信を記録して見つけた。
   **その手順は `standards/web/verify-no-external.mjs` にしてある**（2026-08-29）。
   実行時に組み立てた URL は静的検査には原理的に見えないので、こちらでしか出ない。
   週次の巡回は `.github/workflows/verify-runtime.yml`。
2. **Zero PII**: 児童の個人情報を一切扱わない（Local First）。
3. **正本同期の徹底**: 共通コード（SW生成、検査、records等）は `standards/` 配下を正本とし、個別リポジトリを直接修正しない。
4. **SW版数整合性**: `tools/build-sw.mjs` を通じてファイル内容からキャッシュ版数を刻む。
5. **検査は、順番で結果が変わってはいけない。** 生成物の検査は「コミットされている
   中身」と比べる（`standards/vendor/verify-generated.mjs`）。作業ツリーのファイルと
   比べる書き方に戻さないこと。2026-08-28、`ci = npm run build && npm run verify` と
   書いていた 10 本すべてで、わざと壊した生成物が素通りした（build が控えを取る前に
   生成物を上書きするため）。**検査を足したら、それを呼ぶ側まで見ること。**
   同じ日に、`verify` を書いたのにワークフローが一度も呼んでいない repo が 6 本あった。

## 主要コマンド

⚠️ このリポジトリに `package.json` は無い。`npm test` は動かないので使わないこと
（2026-08-28 まで、この表に `npm test` と書いてあった）。

```bash
# テスト（CI と同じ順。.github/workflows/standards-ci.yml が正）
node --test standards/lib/*.test.mjs
node --test standards/gas/*.test.mjs
node --test standards/check-drift.test.mjs
node --test standards/sw/*.test.mjs
node --test standards/web/*.test.mjs
node --test standards/fonts/*.test.mjs
node --test standards/vendor/*.test.mjs
node --test standards/records/records-export.test.mjs
node --test standards/agents/hooks/*.test.mjs
node --test tools/check-distribution.test.mjs tools/lib/*.test.mjs tools/verify-runtime.test.mjs tools/fleet-status.test.mjs
node --test standards/skills/*/scripts/*.test.mjs

# 正本ドリフト検査（--standards は必須。省くと exit 2）
node standards/check-drift.mjs --standards standards

# SW版数検査 / 配布状況監査 / 正本一括配布
node tools/build-sw.mjs --check
node tools/check-distribution.mjs --skip-repo-list
node tools/distribute.mjs --dry-run

# 艦隊の状態（42本を1回で読む。1本ずつ歩くと文脈が埋まる）
node tools/fleet-status.mjs --todo     # 違反 → 直し方 → 使う正本の道具
node tools/verify-runtime.mjs          # 公開中の画面を実ブラウザで巡回して実測
```

## エージェントの置き場（Claude Code と Antigravity）

| 置き場 | 誰が読むか | 中身 |
| --- | --- | --- |
| `.claude/skills/<名前>/` | Claude Code | 正本 `standards/skills/` へのシンボリックリンク |
| `.agents/skills/<名前>/` | Antigravity（Gemini） | 同上 |
| `.agents/rules/gigaschool-standards.md` | Antigravity | 正本 `standards/agents/rules/` へのシンボリックリンク |
| `CLAUDE.md`（リポジトリ直下） | Claude Code | 上のルールを `@` で取りこむ。正本は `standards/agents/CLAUDE.md` |
| `.claude/settings.json` ＋ `.claude/hooks/` | Claude Code | 正本 `standards/agents/`。配布先でだけ働く（下記） |

**ルール 3 は、配布先では hook が機械的に止める。**
`guard-canonical.mjs`（PreToolUse）が `standards-map.json` を読み、正本のコピーを
直接編集しようとしたら exit 2 で止めて直し方を返す。判定表を自前で持たないので、
正本を 1 本足しても hook 側の直し忘れが起きない。
`unmanaged` で宣言された場所は止めない（宣言の意味が逆になるため）。
**ポータルでは働かない**（`standards/check-drift.mjs` の有無で判定）。正本を持つ側で
止めると正本そのものが直せなくなる。
`announce-checks.mjs`（SessionStart）は、そのリポジトリに**実在する**検査だけを出す。

⚠️ **hook は必ず fail-open。** 読み込みでも解析でも、おかしければ黙って通す。
壊れた hook が 42 本の編集を止めるほうが、防ごうとしている事故よりはるかに重い。

⚠️ **Claude Code と Antigravity で読む場所が違う。** Antigravity は `.agents/rules/` を
直接読むが、Claude Code はリポジトリ直下の `CLAUDE.md` しか読まない。
2026-08-29 まで後者を配っていなかったので、**40 本で Claude Code だけが
Zero-CDN も Zero-PII も知らないまま作業を始めていた。**
ルール本文は 1 本のまま、入口だけを 2 か所に置いて解いてある。

**ポータルは正本を持つ側なので、写しを作らずリンクを張る。**
配布先には `distribute.mjs` が両方の置き場へ**写す**（`SKILL_ROOTS`）。
どちらの置き場も `standards-map.json` の `dirs` に 1 行ずつ登録され、
`check-drift.mjs` が両方を照合する。**片方だけ登録すると、もう片方は
書き替えても緑のまま通る**（2026-08-28 に実測して直した）。
