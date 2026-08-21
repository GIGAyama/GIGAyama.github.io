# GAS アプリの再デプロイ手順（2026-08-21 更新・フェーズ4の緊急ドリフト修正ぶん）

GAS を持つアプリは、GitHub にマージしただけでは本番に反映されません。
**下の表の 8 本は、script.google.com で再デプロイするまで旧動作のまま**です。
順序の指定はありません（相互依存なし）。1本ずつ、都合のよいときに進めてください。

## 今回の再デプロイ対象（8本）

| リポジトリ | 変更内容（マージ済みPR） | 再デプロイ後の確認 |
|---|---|---|
| mirai-compass | AI仮名化に1文字名ガード (#21) | AI機能を1回実行し、本文が壊れないこと |
| townmap_mikke | 仮名化ガード＋レジストリ更新のロック9か所＋再発行の丸ごと引き継ぎ＋Geminiキーをヘッダへ (#17) | 参加承認→人数表示、コード再発行→旧URLに「無効」案内、AI分析1回 |
| online-publisher-pro | 学級コード発行を Math.random() → SHA-256 へ (#16) | 新規クラス作成でコードが発行されること |
| reflection_journal | コード再発行に墓標＋Geminiキーをヘッダへ (#30) | コード再発行→旧URLに TENANT_REVOKED 案内、AIフィードバック1回 |
| moral_note | Geminiキーをヘッダへ（3か所） (#11) | AI機能（質問生成など）を1回実行 |
| linker-clipper | Geminiキーをヘッダへ (#4) | AI分類を1回実行 |
| gamification | Geminiキーをヘッダへ (#42) | まなびクエストのAI一括処理を1回実行 |
| schoolplan_editor | Geminiキーをヘッダへ（3か所＋モデル一覧取得） (#74) | 設定画面のモデル一覧取得と、AI生成を1回実行 |

- homework_barcordreader の仮名化ガード (#38) は **Pages 配信の web ファイル**（src/teacherAiPrivacy.js）の修正で、
  GAS（code.gs）は触っていないため**再デプロイ不要**（マージで自動反映）。
- reflection_journal の GAS 版は凍結中と聞いていますが、コード再発行と AI 機能を使う場合は上記の反映が必要です。

## 再デプロイの基本手順

1. 対象リポジトリの main を pull する
2. script.google.com で該当プロジェクトを開き、.gs / .html を差し替える（clasp 管理があれば `clasp push`）
3. 「デプロイ」→「デプロイを管理」→ 既存デプロイを**編集**して新しいバージョンを選ぶ
   （「新しいデプロイ」を作ると /exec の URL が変わり、配布済みリンクが全部切れるので注意）
4. 上の表の「再デプロイ後の確認」を1回ずつ実施する

## 参考: GAS 持ちリポジトリの全一覧（13本）

schoolplan_editor / gamification / mirai-compass / moral_note / physicaleducation_note /
online-publisher-pro / digital-newspaper / haiku-meeting / homework_barcordreader /
shared-folder-sync / linker-clipper / townmap_mikke / reflection_journal

（physicaleducation_note / digital-newspaper / haiku-meeting / shared-folder-sync は今回の変更対象外）
