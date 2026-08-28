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
- テスト実行: `npm test` または `node --test standards/lib/*.test.mjs`
- 正本ドリフト検査: `node standards/check-drift.mjs`
- SW版数検査: `node tools/build-sw.mjs --check`
- 配布状況監査: `node tools/check-distribution.mjs --skip-repo-list`
- 正本一括配布: `node tools/distribute.mjs --dry-run`
