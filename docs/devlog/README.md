# 開発記録の置き場

ここに置いた `<日付>-<短い名前>.md` が、毎朝 6:17 に
`giga-school.com/devlog/<アプリ>/<記事>/` に組み直される（`tools/build-devlog.mjs`）。

書き方は `standards/skills/devlog-article/`。セッションの中でスキルを呼ぶ。

⚠️ **front matter の `published` が `true` のものだけが出る。** 既定は `false`。
プロンプトには生の事情が混ざるので、公開は書いた本人が目で見て決める。

⚠️ **`README.md` は拾われない。** 拡張子ではなくファイル名で外してある。
