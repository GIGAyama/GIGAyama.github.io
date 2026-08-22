# 型E — 担任がデプロイする形へ移す

対象: 児童が読み書きする GAS アプリ（townmap_mikke, reflection_journal,
online-publisher-pro, moral_note, gamification ほか）

この文書は「なぜ移すのか」「移した先はどういう形か」「何から手を付けるか」を
決めるためのもの。手順書ではない。実際の移行は1本ずつ、それぞれの PR で行う。

---

## 1. いまの形と、そのままでは公開できない理由

実装を読んで整理すると、GAS アプリは4つの形に分かれる。

| 型 | 実行者 | データの持ち主 | 例 |
| --- | --- | --- | --- |
| A | アクセス者 | 使う人それぞれ | schoolplan_editor |
| B | 教師=アクセス者 / 児童=アプリアカウント | 学級ごと | townmap_mikke, reflection_journal |
| C | アクセス者 | 学級ごと | online-publisher-pro |
| D | 運営者 | 単一 | moral_note, gamification |

**型A は問題がない。** 教師だけが使い、一人ひとりが自分の権限で自分の
スプレッドシートを作る。運営者は関与しない。

**型B・C・D は、そのままでは他校・他自治体に公開できない。**

- **型B** — 児童の書き込みは「アプリアカウント（＝運営者の Google アカウント）
  として実行」で行われる。`ss.addEditor(appAccount)` が心臓部で、児童自身は
  Drive の権限を一切持たない。つくりとしてはよくできているが、
  **児童が書いたものが運営者のアカウント経由で保存される**。
  学校のドメイン設定によっては外部アカウントへの共有が禁じられていて機能不全に
  なるし、動いたら動いたで、運営者が他校の児童データに触れられる状態になる。
  運営者としてそこに立ち会うことはできない。
- **型C** — テナントのスプレッドシートを `ANYONE_WITH_LINK` ＋ 編集権限で
  共有している。児童は生のスプレッドシートを直接開けてしまう。
  アプリの画面を通さずに、他の児童の記録も、消すこともできる。
- **型D** — `access: DOMAIN` で1つのデータベースを共有している。
  ドメインが違えば入れない。他校の先生は使えない。

### 三すくみ

GAS では、次の3つを同時に満たせない。

1. 運営者がデータを持たない
2. 児童が生のスプレッドシートに触れない
3. 単一のデプロイで全校に配る

型B は 2と3 を取って 1 を捨てている。型C は 1と3 を取って 2 を捨てている。
型D は 1と2 を取って 3 を捨てている。

**型E は 1と2 を取り、3 を捨てる。** 担任が自分でコピーしてデプロイすれば、
「自分として実行」の"自分"が担任になる。児童のデータは担任のドライブにだけ
あり、運営者は一切関与しない。児童は Drive 権限を持たず、アプリの画面越しに
しか触れない。代わりに、更新をこちらから一斉に配ることはできなくなる。

型D が捨てている 3 は「他校が使えない」という致命的な形で表れるが、
型E が捨てる 3 は「更新のたびに担任に一手間をかけてもらう」という形で表れる。
後者のほうが、越境公開の障害としては小さい。

---

## 2. 型E の形

```
  児童・教師のブラウザ
        │
        │  ① 画面（HTML/CSS/JS）は Pages から
        ▼
  https://<app>.giga-school.com     ← GitHub Pages（運営者が配る）
        │
        │  ② データの読み書きだけ、担任の exec URL へ POST
        ▼
  https://script.google.com/macros/s/…/exec   ← 担任がデプロイ
        │                                        「実行するユーザー: 自分」
        ▼                                        「アクセスできるユーザー: 全員」
  担任のスプレッドシート（担任のドライブの中）
```

要点は **画面を Pages 側に寄せる** こと。GAS 側には doPost だけを置く。

こうすると:

- **更新の大半は Pages 側で済む。** 画面の直し・文言・レイアウトは、
  こちらがマージすればその場で全校に届く。担任の作業は要らない。
- **担任にお願いするのは、doPost の中身（`Code.gs`）を変えたときだけ**になる。
  データの持ち方を変えるような、そう頻繁には起きない変更に限られる。
- **exec URL の受け渡し**は、担任が自分のクラスの子に配る QR／リンクに
  `?gas=<exec URL>` として載せるか、児童が最初の1回だけ貼り付ける。
  端末の `localStorage` に覚えさせておけば、以後は入力不要。

linker-clipper は**すでにこの形で動いている**。学校ごとにスプレッドシートを
持ち、拡張機能側が利用者ごとの exec URL を `chrome.storage.local` に保存する。
作者のアカウントはどこにも出てこない。

---

## 3. 通信の作り方（ここが一番つまずく）

Pages のページから GAS を直接 fetch するとき、GAS 特有の穴がいくつもある。
どれも「動かない理由が画面に出ない」形で失敗するので、各アプリで書き直さず、
正本 **`standards/web/giga-gas-client.js`** を使う。

| 穴 | どうなるか | 手当て |
| --- | --- | --- |
| `Content-Type: application/json` | ブラウザがプリフライト（OPTIONS）を出す。GAS は OPTIONS に答えられないので必ず失敗 | `text/plain;charset=utf-8` で送る。中身は JSON のままでよい |
| `/exec` は 302 で `script.googleusercontent.com` へ飛ぶ | 追わないと本文が読めない | `redirect: 'follow'` |
| `mode: 'no-cors'` | 応答が opaque になり、成功と失敗を区別できない | 使わない。通常の cors で status と本文を見る |
| 未ログイン・権限不足 | ログイン画面の HTML が返り、`JSON.parse` が落ちる | HTML を見分けて「アクセス権を確かめてください」と言う |
| GAS の実行が詰まる | ブラウザが待ち続ける | `AbortController` で時間を切る |
| 同時実行の上限・一時的な 500 | 児童が一斉に開くと数人だけ書けない | 429/5xx とネットワークエラーだけ、時間を空けて試し直す |
| `/dev` の URL を配ってしまう | 担任本人には見えるのに、児童側は真っ白 | URL の形を通信前に検査して断る |

GAS 側の受け口:

```js
function doPost(e) {
  var req = JSON.parse(e.postData.contents);   // { action, params }
  try {
    var data = route_(req.action, req.params || {});
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, code: codeOf_(err), error: messageOf_(err) });
  }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

`{ ok: false }` は**通信が成功した中で**返る。クライアントはこれを例外に
変える（`giga-gas-client.js` がそうしている）。そうしないと、
「断られた」ことに呼び出し側が気づけない。

---

## 4. 誰であるかの見分け方

型E では exec URL 自体が担任のデプロイなので、入口は2つ。

1. **URL を知っていること** — 担任がクラスの子にだけ配る
2. **Google にログインしていること** — `Session.getActiveUser().getEmail()`

「アクセスできるユーザー: 全員」でデプロイすると、`getActiveUser()` は
同一ドメイン内でしかメールを返さないことがある。ここは学校の設定に左右される
ので、**名簿との突き合わせを唯一の頼りにしない**。

型B・C が使っていた「クラスコード＋児童の選択」の仕組みは、型E でもそのまま
使える。運営者が消えるだけで、学級の中の見分け方は変わらない。

なお型E では、**児童がスプレッドシートを直接開けない**（担任が共有していない）。
型C の弱点はここで自然に消える。

---

## 5. 移行の順番

型E への移行は、アプリごとに「GAS 側にどれだけ画面が乗っているか」で
手間がまったく違う。

| アプリ | いまの型 | GAS 側の画面 | 見積もり |
| --- | --- | --- | --- |
| online-publisher-pro | C | 少ない | 小 — 共有のしかたを変えるだけで 2 が直る |
| moral_note | D | `js.html` ほか | 中 |
| gamification | D | あり | 中 |
| reflection_journal | B | `app.html` | 大 |
| townmap_mikke | B | `App.html`（4,654 行） | 大 |

**最初の1本は online-publisher-pro を薦める。** 型C なので運営者はもともと
データを持っておらず、直すべきは「児童が生シートを開ける」の1点。
`shareTenantStorage_` の `ANYONE_WITH_LINK` + EDIT をやめ、担任のデプロイに
読み書きを通す形にすれば、それだけで型E になる。画面の引っ越しも小さい。

townmap_mikke と reflection_journal は、`App.html` / `app.html` を Pages へ
移す作業が本体になる。ここは急がず、通信の正本（`giga-gas-client.js`）が
1本の実アプリで動いたことを確かめてから着手する。

---

## 6. 先に実機で確かめてほしいこと

**この2点はコードから確かめられない。** 担任役のアカウントで1回試して
もらう必要がある。ここが通らないと型E は成り立たないので、
移行に着手する前に確かめたい。

1. **担任が自分でデプロイできるか**
   学校配布の Google アカウントで、Apps Script の「デプロイ」→
   「ウェブアプリ」→「アクセスできるユーザー: 全員」が選べるか。
   組織のポリシーで「全員」が禁じられている場合、型E は
   同一ドメイン内でしか使えない（それでも型D よりは広い）。

2. **Pages のページから exec URL を直接 fetch できるか**
   `standards/web/giga-gas-client.js` の作りは linker-clipper の
   拡張機能で実証済みだが、**拡張機能は通常のウェブページより CORS の制約が
   緩い**。`https://<app>.giga-school.com` に置いたページから同じことが
   できるかは、実機で1回試すまで断定できない。

2 が通らなかった場合の逃げ道は、GAS 側の画面を残したまま iframe で
埋め込む従来の形（型B・C が使っている postMessage ハンドシェイク）に
戻すこと。その場合も「担任がデプロイする」という型E の要点は変わらない。

---

## 7. 関連する正本

- `standards/web/giga-gas-client.js` — Pages から GAS を呼ぶクライアント
- `standards/gas/Gemini.gs` — Gemini の呼び出し（再試行・キーのヘッダ渡し）
- `standards/docs/gas-redeploy.md` — 再デプロイが必要なリポジトリの一覧
