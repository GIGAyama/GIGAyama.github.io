# giga-school.com

小学校の教員（GIGAyama）がつくった Web アプリの公開サイトです。
このリポジトリは、独自ドメイン `giga-school.com` のルートを配信します。

- 公開 URL：<https://giga-school.com/>
- 各アプリ：`アプリ名.giga-school.com`（それぞれ別のリポジトリで配信）

## 役割

1. **公開中のアプリへの入口**（Web アプリ 44 本、Chrome 拡張機能・ツール 7 本）
2. **サイトの所有権確認**
   Google Search Console の HTML ファイル確認用ファイルをルートに置いています。
   OAuth 同意画面（Google Auth Platform）の審査では、ホームページ URL のオリジンについて
   所有権の確認が必要になります。各アプリはサブドメインで配信されるため、
   オリジンのルートを配信するこのリポジトリがないと、ルートでの所有権確認ができません。

> [!IMPORTANT]
> `google*.html` は Search Console の確認ファイルです。**削除すると所有権の確認が外れ、
> OAuth 審査が差し戻される**ことがあります。移動・改名しないでください。

## 構成

```
index.html            トップページ（カードはすべて HTML に直接書いてある）
404.html              見つからないページ
site.webmanifest      PWA マニフェスト
robots.txt / sitemap.xml
assets/
  style.css           スタイル（@layer で reset → tokens → base → layout → components → utilities）
  app.js              検索・カテゴリ絞り込み・テーマ切り替え
  logo.svg            ロゴマーク（配布用。ページ内では色を変えるため直接埋め込んでいる）
  favicon.svg         ファビコン
  apple-touch-icon.png / icon-512.png
  og.png              OGP 画像（1200×630）
```

ビルドの手順はありません。npm も不要です。HTML・CSS・JavaScript をそのまま配信します。

## アプリを追加・変更するとき

`index.html` の該当箇所を直接編集します。

1. **Web アプリ** … `<ul class="cards" id="app-list">` の中に `<li class="card">` を追加します。
   既存のカードをコピーし、次の 4 か所を書き換えてください。
   - `data-cat` … カテゴリの id（`kokugo` / `sansu` / `tankyu` / `gakkyu` / `koumu` /
     `seisaku` / `game` / `other`）
   - `data-name` と `data-keywords` … 検索に使う語。漢字の語は、ひらがなの読みも足しておくと
     児童が探しやすくなります。
   - `style="--cat:…"` と `<span class="tag">` … カテゴリの色と表示名
   - リンク（アプリ本体・プライバシーポリシー・利用規約・GitHub）
2. **カテゴリの件数** … 絞り込みボタン（`.chip`）の `<span class="count">` と、
   見出し・ヒーローの本数を合わせて直します。
3. **Chrome 拡張機能など** … `#tools` の中のカードを同じ要領で編集します。
4. 最後に、フッターの「最終更新」の `<time datetime="…">` を更新します。

## 設計の方針

- **依存ライブラリなし。** 外部の CSS・JavaScript・Web フォント・画像を読み込みません。
  読み込みが速く、外部サービスに閲覧の記録が渡りません。
- **JavaScript が無くても読める。** 51 本のカードはすべて HTML に書いてあります。
  JavaScript は検索・絞り込み・テーマ切り替えだけを担い、無効なときはそれらを表示しません。
- **配色は明暗どちらでも AA 以上。** 本文と背景の組み合わせは、コントラスト比 4.5:1 を上回る値を
  選んでいます。OS の設定に追従し、ヘッダーのボタンで切り替えもできます。
- **誇張しない。** 説明文は、そのアプリが実際にしていることだけを書きます。

## GitHub Pages の設定

Settings > Pages で、Source を「Deploy from a branch」、Branch を `main` /
フォルダを `/ (root)` にします。独自ドメインは `CNAME` で指定しています。
