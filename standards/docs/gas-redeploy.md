# GAS アプリの再デプロイ手順（共通基盤統一・フェーズ4で更新）

GAS を持つアプリは、GitHub にマージしただけでは本番に反映されません。
コード統一のフェーズ4が進んだら、この文書に「どのリポジトリを・いつ・どの順で
script.google.com で再デプロイするか」の一覧を記載します。

現時点の GAS 持ちリポジトリ（13本）:
schoolplan_editor / gamification / mirai-compass / moral_note / physicaleducation_note /
online-publisher-pro / digital-newspaper / haiku-meeting / homework_barcordreader /
shared-folder-sync / linker-clipper / townmap_mikke / reflection_journal（GAS版は凍結、Driveネイティブへ移行済み）

再デプロイの基本手順:
1. 対象リポジトリの main を pull する
2. script.google.com で該当プロジェクトを開き、.gs / .html を差し替える（clasp 管理があれば `clasp push`）
3. 「デプロイ」→「デプロイを管理」→ 既存デプロイを**編集**して新しいバージョンを選ぶ
   （「新しいデプロイ」を作ると /exec の URL が変わり、配布済みリンクが全部切れるので注意）
4. アプリを開いて動作確認
