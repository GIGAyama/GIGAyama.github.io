# GIGAyama.github.io — Claude Code 開発ガイド

本リポジトリは、GIGAスクールWebアプリ群（giga-school.com）の旗艦ポータル兼共通コードの正本（Single Source of Truth）です。

## マスター仕様書
本システムの全体像、アーキテクチャ、データフロー、障害教訓については、以下を参照してください：
- [SYSTEM_MASTER.md](docs/architecture/SYSTEM_MASTER.md)

## 開発・改修時の最重要ルール
1. **Zero External CDN**: 外部CDN（unpkg, cdnjs, Google Fonts等）のランタイム読み込み禁止。
2. **Zero PII**: 児童の個人情報を一切扱わない（Local First）。
3. **正本同期の徹底**: 共通コード（SW生成、検査、records等）は `standards/` 配下を正本とし、個別リポジトリを直接修正しない。
4. **SW版数整合性**: `tools/build-sw.mjs` を通じてファイル内容からキャッシュ版数を刻む。

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
node --test standards/records/records-export.test.mjs
node --test tools/check-distribution.test.mjs tools/lib/*.test.mjs
node --test standards/skills/*/scripts/*.test.mjs

# 正本ドリフト検査（--standards は必須。省くと exit 2）
node standards/check-drift.mjs --standards standards

# SW版数検査 / 配布状況監査 / 正本一括配布
node tools/build-sw.mjs --check
node tools/check-distribution.mjs --skip-repo-list
node tools/distribute.mjs --dry-run
```

## エージェントの置き場（Claude Code と Antigravity）

| 置き場 | 誰が読むか | 中身 |
| --- | --- | --- |
| `.claude/skills/<名前>/` | Claude Code | 正本 `standards/skills/` へのシンボリックリンク |
| `.agents/skills/<名前>/` | Antigravity（Gemini） | 同上 |
| `.agents/rules/gigaschool-standards.md` | Antigravity | 正本 `standards/agents/rules/` へのシンボリックリンク |

**ポータルは正本を持つ側なので、写しを作らずリンクを張る。**
配布先には `distribute.mjs` が両方の置き場へ**写す**（`SKILL_ROOTS`）。
どちらの置き場も `standards-map.json` の `dirs` に 1 行ずつ登録され、
`check-drift.mjs` が両方を照合する。**片方だけ登録すると、もう片方は
書き替えても緑のまま通る**（2026-08-28 に実測して直した）。
