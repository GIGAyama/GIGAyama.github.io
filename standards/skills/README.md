# スキルの正本

`.claude/skills/` に置いて使うスキルの、正本の置き場。

```
standards/skills/
└── devlog-article/    開発記録（giga-school.com/devlog/）の記事を書く
```

## 置き方

このリポジトリでは `.claude/skills/devlog-article` からシンボリックリンクを張ってある。
写しを作らないのは、`standards/` のほかのものと同じ理由で、
2 つになった時点でどちらが正本か分からなくなるため。

アプリ側のリポジトリで使うときは、いまのところ手で置く。

⚠️ **`tools/distribution.json` の配布はまだ `.claude/skills/` を見ていない。**
`standards/` の下にありながら、32 本のリポジトリには配られない。
`note-article` スキルも同じで、Ice_slide-puzzle 1 本にしか置かれていない。
配布に載せるかどうかは、両方まとめて決める（この判断は別の変更で）。

## 検査

スキルの中の検査は、スキル自身が持っている。

```
node standards/skills/devlog-article/scripts/lint-devlog.mjs docs/devlog/<記事>.md
```

⚠️ `note-article` の `lint-article.mjs` は流用できない。理由は
`devlog-article/SKILL.md` の「4. 機械で確かめる」に書いてある。
