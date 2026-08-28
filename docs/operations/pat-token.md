# PAT_TOKEN の設定と更新（正本の自動配布に必要）

`auto-distribute.yml`（正本を全リポジトリへ自動配布）は、**`PAT_TOKEN` という
リポジトリ Secret が無いと 1 本も配れません。** ここはその設定手順と、
期限切れで再び止まったときの直し方を残しておく場所です。

対象: `GIGAyama.github.io` の Settings（管理者のみ）
所要: 5〜10 分

---

## 1. なぜ要るのか

`auto-distribute.yml` は、ポータルから **他の 42 本のリポジトリへ push** します。
ところが GitHub Actions が既定で配る `GITHUB_TOKEN` は、
**そのワークフローが動いているリポジトリにしか書けません。**
他のリポジトリへ push しようとすると、必ずこうなります。

```
remote: Permission to GIGAyama/word_basket.git denied to github-actions[bot].
fatal: unable to access '…': The requested URL returned error: 403
```

つまり「配布のとりのこしをゼロにする」という設計全体が、
**リポジトリをまたげるトークン 1 つ**に乗っています。

### 実際に起きたこと（2026-08-28）

PR #96 のマージで `auto-distribute` が発火し、**42 本すべてが失敗**しました。

```
Failed : 42
```

ワークフローは当時 `secrets.PAT_TOKEN || secrets.GITHUB_TOKEN` と書かれており、
`PAT_TOKEN` が無いと `GITHUB_TOKEN` に落ちる作りでした。
**落ちた先が原理的に成功しえない相手**だったので、
42 本ぶんの 403 が並ぶだけで、ログのどこにも
「PAT_TOKEN が無い」とは書かれませんでした。

いまは先頭で有無を見て、無ければ理由を書いて止めます。
落ちる回数は減りませんが、**理由の見えない失敗 42 回より、
見える失敗 1 回のほうがまし**という判断です。

---

## 2. トークンの種類

**Fine-grained personal access token** を使います。
`GIGAyama` は個人アカウントなので、そのまま作れます。

Classic PAT でも動きますが、`repo` スコープが全リポジトリへの全権になるため、
必要な権限だけを選べる Fine-grained のほうを既定とします。

---

## 3. 作成手順

**GitHub → 右上のアイコン → Settings → Developer settings →
Personal access tokens → Fine-grained tokens → Generate new token**

| 項目 | 設定する値 |
| --- | --- |
| Token name | `giga-auto-distribute`（分かる名前なら何でもよい） |
| Expiration | 90 日〜1 年（§6 の注意を読んでから決める） |
| Resource owner | `GIGAyama` |
| Repository access | **All repositories**（43 本を個別に選んでもよい） |

**Repository permissions** を次のように設定します。
「なぜ必要か」は `tools/distribute.mjs` が実際に叩くコマンドです。

| 権限 | 値 | 根拠となる操作 |
| --- | --- | --- |
| **Contents** | Read and write | `git push -u origin chore/sync-standards`、`gh repo clone` |
| **Pull requests** | Read and write | `gh pr create` / `gh pr merge` |
| **Workflows** | **Read and write** | §4 を必ず読むこと |
| Metadata | Read-only | `gh repo list GIGAyama`（必須・自動で付く） |
| Administration | Read and write | 任意。`gh pr merge --admin` 用。無くても後続の代替経路で通る |

---

## 4. ⚠️ Workflows 権限を忘れると、9 本だけ落ちます

`standards-map.json` を見ると、**9 本のリポジトリが正本から
`.github/workflows/deploy.yml` を受け取っています。**

- Gamification / Haiku-meeting / MIRAI-Compass / Moral_note /
  Online-Publisher-pro / PhysicalEducation_note / Reflection_Journal /
  SchoolPlan_Editor / Townmap_Mikke

PAT でワークフローファイルを push するには専用の権限が要ります。
無いと、その 9 本だけがこう言って落ちます。

```
refusing to allow a Personal Access Token to create or update workflow
`.github/workflows/deploy.yml` without `workflow` scope
```

**33 本は成功して 9 本だけ失敗する**という、いちばん読み解きにくい形になります。
Contents と Pull requests だけ入れて満足しないこと。

---

## 5. Secret として登録する

**`GIGAyama.github.io` の Settings → Secrets and variables → Actions →
New repository secret**

| 項目 | 値 |
| --- | --- |
| Name | `PAT_TOKEN` |
| Secret | 生成したトークン |

⚠️ 名前は `PAT_TOKEN` ちょうどでなければなりません。
ワークフローがこの名前で読んでいます。

### 動作確認

`auto-distribute.yml` は `workflow_dispatch` を持っているので、
`standards/` を触らなくても手で試せます。

**Actions → 「正本を全リポジトリへ自動配布」→ Run workflow**

通っていれば、こうなります。

- 先頭の検査が `PAT_TOKEN は設定されています` を出す
- 最後のサマリが `Failed : 0`

`Failed` が残ったら、その行にリポジトリ名とエラーが出ます。
403 の羅列にはならないので、原因はそこで読めます。

---

## 6. 期限切れのときに起きること

Fine-grained PAT には期限があります。切れると **また 42 本の 403 に戻ります。**

⚠️ **先頭の検査は「未設定」しか捕まえられません。**
期限切れのトークンは「値が入っている」ので検査を通ってしまい、
その先で 403 になります。つまり症状は、対策を入れる前と同じ形に戻ります。

- 期限日をカレンダーに入れておく
- 403 が並んだら、まずこの文書を思い出して**トークンの期限を疑う**

---

## 7. 設定されていないあいだの回し方

`PAT_TOKEN` が無くても、正本そのものは手で配れます。
ポータルと配布先を隣り合わせに置いた状態で:

```bash
# 何が変わるかだけ見る（push も PR も作らない）
node tools/distribute.mjs --dry-run

# 1 本だけ試す
node tools/distribute.mjs --dry-run --repo Typa
```

`--dry-run` でも**ファイルのコピーは行われます**（git 操作をしないだけ）。
そのあとは各リポジトリで自分でコミットして push します。

`Already Synced: 42 / Failed: 0` と出れば、配るものは残っていません。

---

## 関連

- `.github/workflows/auto-distribute.yml` — このトークンを使うワークフロー
- `tools/distribute.mjs` — 実際に配る本体
- `docs/architecture/SYSTEM_MASTER.md` §3.2 — 正本同期の全体像
