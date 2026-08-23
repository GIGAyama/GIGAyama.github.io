# GASへの反映を自動にする

対象: GAS を持つリポジトリ全部（schoolplan_editor で先に動いている仕組みを、
残りへ広げたもの）

## これで何が変わるか

これまでは、変更のたびに Apps Script エディタへファイルを手でコピーして
いました。1つ貼り忘れると、起動時に「〇〇 is not defined」とだけ出ます。

設定を済ませると、`main` にマージした時点で次が自動で走ります。

1. そのリポジトリのゲート（`npm run quality` / `ci` / `check` のうち在るもの）
2. **いま GAS にある中身の控えを取る**（成果物として30日残る）
3. **送ると消えるファイルが無いかを確かめる**（あれば、GAS に触れずに止まる）
4. リポジトリの内容を GAS プロジェクトへ反映
5. **既存のデプロイ**を新しいバージョンへ差し替え（**URL は変わりません**）

ゲートが落ちたら、GAS には一切触れません。

**シークレットを1つも登録していないうちは、この仕組みは何もせずに終わります。**
リポジトリに入れただけでは本番は動きません。登録した時点から効き始めます。

## 手順1: Apps Script API をオンにする（アカウントに1度だけ）

<https://script.google.com/home/usersettings> を開き、「Google Apps Script API」
をオンにします。オフだと、ツールからの反映がすべて拒否されます。

## 手順2: 手元でログインする（1度だけ）

```bash
npm run gas:install   # clasp を入れる（リポジトリの依存には含めていません）
npm run gas:login     # ブラウザが開くので、GASプロジェクトの持ち主のアカウントで許可する
```

`~/.clasprc.json`（Windows は `%USERPROFILE%\.clasprc.json`）ができます。
**この中身が鍵そのものです。** 人に見せたり、リポジトリに置いたりしないでください。

**この1つのファイルを、すべてのリポジトリで使い回せます。** GAS プロジェクトが
同じ Google アカウントの持ち物である限り、リポジトリごとに取り直す必要は
ありません。

## 手順3: リポジトリごとにシークレットを登録する

**Settings → Secrets and variables → Actions → New repository secret**

| 名前 | 何を入れるか | どこで分かるか |
|---|---|---|
| `GAS_SCRIPT_ID` | スクリプトID | Apps Script エディタのURL `.../projects/**ここ**/edit` |
| `GAS_DEPLOYMENT_ID` | デプロイID | Apps Script →「デプロイを管理」→ 対象のデプロイ →「デプロイID」 |
| `CLASPRC_JSON` | `~/.clasprc.json` の**中身をまるごと** | 手順2で作られたファイル |

`CLASPRC_JSON` は全リポジトリで同じ値です。残り2つはリポジトリごとに違います。

### デプロイが2つあるとき（教師用と児童用）

townmap_mikke と reflection_journal は、同じスクリプトを教師用と児童用の
2つのデプロイで公開しています。この場合は `GAS_DEPLOYMENT_ID` の代わりに
**`GAS_DEPLOYMENT_IDS`** を作り、カンマ区切りで両方を入れてください。

```
AKfycb...(教師用),AKfycb...(児童用)
```

片方だけ入れると、もう片方は古いまま残ります。**児童側だけ古い**という形は
気づきにくいので、必ず両方入れてください。

### GAS の中身がリポジトリ直下に無いとき

gamification は `manabi-quest/` の下に GAS プロジェクトが入っています。
この場合は **Variables**（Secrets ではなく、隣のタブ）に

| 名前 | 値 |
|---|---|
| `GAS_ROOT_DIR` | `manabi-quest` |

を登録してください。直下にあるリポジトリでは不要です。

## 手順4: 送るものを手元で確かめる

```bash
GAS_SCRIPT_ID=<スクリプトID> npm run gas:status
```

`Tracked files` に GAS のファイルだけが並び、`docs/` や `tests/` や
`node_modules/` が `Untracked files` 側にあれば正しい状態です。

`privacy.html` や `terms.html`（GitHub Pages に置いている法務ページ）が
Tracked 側に混ざっていたら、`.claspignore` を直してください。

## 「送るとGASから消えるファイルがあります」と出たとき

これは**壊れる前に止まった**というしるしです。次のどれかです。

1. **いちばん最初の反映で、`コード.gs` が消えると言われた** — これは
   **正常です。直すのは 1 手**。スプレッドシートで「拡張機能 → Apps Script」を
   開くと、Google が `コード.gs`（英語UIなら `Code.gs`）という空の
   ファイルを 1 つ作ります。リポジトリ側のファイル名がこれと違えば、
   突き合わせは「消える」と判断します。

   **Apps Script エディタで `コード` をリポジトリ側の名前（多くは `Code`）に
   リネームしてください。** 名前がそろえば消えるものが無くなり、そのまま
   中身が上書きされます。消してしまってもかまいませんが、リネームのほうが
   「コードが 1 つも無い状態」を経由しないぶん安全です。

   見分け方: 控えの `dist/gas-before-push/コード.gs` を開いて、中身が
   `function myFunction() { }` だけなら、これに当たります。

2. **GASエディタで直接足したファイルがある** — もっともよくある形です。
   控え（`dist/gas-before-push/`、CI では成果物）からそのファイルを取り出し、
   リポジトリに取り込んでコミットしてください。
3. **`.claspignore` の書き方で、送るつもりのファイルが外れている** —
   `npm run gas:status` で Tracked 側に出るか確かめてください。
4. **本当に消したい** — そのときだけ `GAS_ALLOW_DELETIONS=1` を付けます。

   ⚠️ **これは手元で `npm run deploy` を動かすときだけ使えます。**
   正本の `deploy.yml` は `GAS_ALLOW_DELETIONS` を Deploy ステップへ
   渡していないので、**GitHub Actions からは指定できません**（渡すには
   正本コピーである `deploy.yml` を書き換えることになり、ドリフト検知が
   赤くなります）。CI で止まったときは 1〜3 のどれかで、**GAS 側を直して
   から再実行**してください。手元から直接押すのは、ゲートを通らず、
   ローカルが古ければ他人の変更を巻き戻すので避けます。

止まった時点で GAS には触れていません。本番はそのままです。

## 「appsscript.json がリポジトリにありません」と出たとき

`appsscript.json` は GAS プロジェクトの設定そのもの（権限のスコープ、
Web アプリの公開範囲、タイムゾーン）です。これを欠いたまま送ると、
**動いていたアプリの権限設定が失われます**。

mirai-compass のように、リポジトリにこのファイルを置いていないものが
あります。次の手順で本番から取り寄せてください。

```bash
npm run gas:install
GAS_SCRIPT_ID=<スクリプトID> npm run gas:backup
cp dist/gas-before-push/appsscript.json ./appsscript.json
git add appsscript.json && git commit -m "chore: 本番の appsscript.json をリポジトリに取り込む"
```

中身（特に `oauthScopes` と `webapp.access` / `webapp.executeAs`）を目で
確かめてからコミットしてください。ここが本番と食い違うと、次の反映で
アプリの公開範囲が変わります。

## 毎回の流れ

**何もしません。** `main` にマージすると `Deploy to Apps Script` が走ります。

反映のあとは、ブラウザ／PWA を完全に再読み込みしてください
（画面側の HTML はキャッシュに残ります）。

### 手元から一発で反映したいとき

```bash
GAS_SCRIPT_ID=<スクリプトID> GAS_DEPLOYMENT_ID=<デプロイID> npm run deploy
```

## 気をつけること

- **「新しいデプロイ」を作ってはいけません。** URL が変わり、配布済みの
  リンク・QR・ブックマークが全部切れます。この仕組みは常に
  **既存のデプロイを新しいバージョンへ差し替え**ます。
- **`clasp push` は GAS 側を丸ごと置き換えます。** GASエディタで直接直す
  習慣があるなら、その変更はリポジトリへ戻してください。手順3の確認で
  止まるようにはしてありますが、リポジトリを正として運用するのが前提です。
- **鍵の失効。** `~/.clasprc.json` の中身は期限で切れることがあります。
  CI が認証で落ちたら、手順2をやり直して `CLASPRC_JSON` を入れ直してください。

## 対象リポジトリ

| リポジトリ | GAS の置き場所 | デプロイ数 | 備考 |
|---|---|---|---|
| schoolplan_editor | 直下 | 1 | 先行して動いている |
| mirai-compass | 直下 | 1 | `appsscript.json` の取り寄せが先に必要 |
| moral_note | 直下 | 1 | |
| physicaleducation_note | 直下 | 1 | |
| digital-newspaper | 直下 | 1 | |
| haiku-meeting | 直下 | 1 | |
| online-publisher-pro | 直下 | 1 | |
| townmap_mikke | 直下 | 2 | 教師用・児童用 |
| reflection_journal | 直下 | 2 | 教師ポータル・児童アプリ |
| gamification | `manabi-quest/` | 1 | `GAS_ROOT_DIR` が要る |

**linker-clipper は対象外**です。あれは学校・自治体ごとに担任／担当者が
自分のスプレッドシートへコピーして自分でデプロイする形（型E）なので、
こちらが押し込む先の「本番のデプロイ」がひとつに定まりません。
更新は README の手順で各導入先が行います。

## 関連する正本

- `standards/gas/gas-deploy.mjs` — 反映を行うスクリプト
- `standards/gas/deploy.yml` — GitHub Actions のワークフロー
- `standards/docs/gas-type-e.md` — 担任がデプロイする形への移行
