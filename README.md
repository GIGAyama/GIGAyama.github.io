# GIGAyama.github.io

`https://gigayama.github.io/` のトップページです。

## 役割

1. 公開中のアプリへの入口
2. **サイトの所有権確認**：Google Search Console の HTML ファイル確認用ファイルをルートに置いています。
   OAuth 同意画面（Google Auth Platform）の審査では、ホームページ URL のオリジンについて
   所有権の確認が必要になります。各アプリはプロジェクトページ
   （`https://gigayama.github.io/<リポジトリ名>/`）として配信されるため、
   オリジンのルートを配信するこのリポジトリがないと、ルートでの所有権確認ができません。

## 注意

`google*.html` は Search Console の確認ファイルです。**削除すると所有権の確認が外れ、
OAuth 審査が差し戻される**ことがあります。移動・改名しないでください。

## GitHub Pages の設定

Settings > Pages で、Source を「Deploy from a branch」、Branch を `main` / フォルダを `/ (root)` にします。
