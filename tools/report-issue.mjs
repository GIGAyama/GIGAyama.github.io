#!/usr/bin/env node
/**
 * 検査の結果を Issue に知らせる。赤なら立て（もう在れば書き替え）、緑なら閉じる。
 *
 *   node tools/report-issue.mjs --key check-distribution \
 *        --title '配布のとりのこしが赤いままです' --status failure \
 *        [--detail-file out.txt] [--run-url https://…] [--hint '直し方の 1 行'] [--dry-run]
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 計算の側（tools/lib/issue-report.mjs）の冒頭に書いてある。
 * 52 日つづいた赤に、誰も気づけなかった（2026-09-19 〜 11-09）。
 *
 * ── 使う場所 ──────────────────────────────────────────
 *
 * ワークフローの最後に、`if: ${{ !cancelled() }}` で置く。
 * `--status` には `${{ job.status }}` を渡す（success / failure / cancelled）。
 * `permissions: issues: write` が要る。
 *
 * ⚠️ **この道具は、ジョブの結果を変えない。** 何が起きても exit 0 で終わる
 *    （引数の間違いだけ exit 2）。知らせる道が壊れたせいで、緑の検査が赤く
 *    なったり、赤い検査が別の理由の赤に化けたりしないため。
 *    届けられなかったときは `::warning::` を出す。
 *
 * ⚠️ 秘密を本文に貼らない。貼るのは検査が標準出力に書いたものだけで、
 *    Actions はログに出た Secret を伏せ字にするが、**ファイルへ tee した
 *    ものは伏せられない**。Secret を出力する検査には使わないこと。
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planReport, findExisting } from './lib/issue-report.mjs';
import { todayJst } from './lib/dates.mjs';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

const API = 'https://api.github.com';

async function gh(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'giga-report-issue',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** 開いている Issue をぜんぶ読む（3 ページまで。それを超えるほど溜めない） */
async function openIssues(repo) {
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const list = await gh('GET', `/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(list)) throw new Error('Issue の一覧が配列ではありません');
    all.push(...list);
    if (list.length < 100) break;
  }
  return all;
}

async function main() {
  const key = arg('key');
  const title = arg('title');
  const status = arg('status');
  const dryRun = process.argv.includes('--dry-run');
  if (!key || !title || !status) {
    console.error('使い方: node tools/report-issue.mjs --key <名前> --title <題> --status <success|failure|cancelled>'
      + ' [--detail-file <道>] [--run-url <URL>] [--hint <直し方>] [--dry-run]');
    return 2;
  }

  /* 取り消された回は、赤でも緑でもない。GitHub へ聞きにいく前に終わる */
  if (status !== 'success' && status !== 'failure') {
    console.log(`Issue（${key}）: することはありません（${status}）`);
    return 0;
  }

  const detailFile = arg('detail-file');
  /* 出力のファイルが無いのは、検査まで届かずに落ちたとき。それでも知らせる */
  const detail = detailFile && fs.existsSync(detailFile) ? fs.readFileSync(detailFile, 'utf8') : '';
  const repo = process.env.GITHUB_REPOSITORY;

  if (!dryRun && (!repo || !process.env.GITHUB_TOKEN)) {
    console.log('::warning::GITHUB_REPOSITORY か GITHUB_TOKEN が無いので、Issue には知らせていません。');
    return 0;
  }

  try {
    const existing = dryRun && !repo ? null : findExisting(await openIssues(repo), key);
    const actions = planReport({
      status, existing, key, title, detail,
      runUrl: arg('run-url'), hint: arg('hint'), today: todayJst(),
    });
    if (actions.length === 0) { console.log(`Issue（${key}）: することはありません（${status}）`); return 0; }

    for (const a of actions) {
      if (dryRun) { console.log(`[dry-run] ${a.op}${a.number ? ` #${a.number}` : ''}\n${a.title ?? ''}\n${a.body ?? ''}\n`); continue; }
      if (a.op === 'create') {
        const made = await gh('POST', `/repos/${repo}/issues`, { title: a.title, body: a.body });
        console.log(`Issue を立てました: #${made.number} ${made.html_url}`);
      } else if (a.op === 'update') {
        await gh('PATCH', `/repos/${repo}/issues/${a.number}`, { body: a.body });
        console.log(`Issue #${a.number} の本文を書き替えました`);
      } else if (a.op === 'comment') {
        await gh('POST', `/repos/${repo}/issues/${a.number}/comments`, { body: a.body });
        console.log(`Issue #${a.number} にひとこと足しました`);
      } else if (a.op === 'close') {
        await gh('PATCH', `/repos/${repo}/issues/${a.number}`, { state: 'closed', state_reason: 'completed' });
        console.log(`Issue #${a.number} を閉じました`);
      }
    }
  } catch (error) {
    /* ⚠️ ここで落とさない。知らせる道が壊れても、検査の結果そのものは変えない */
    console.log(`::warning::Issue に知らせられませんでした（${String(error.message).replace(/\n/g, ' ')}）。`
      + 'ワークフローに permissions: issues: write があるかを見てください。');
  }
  return 0;
}

/* ⚠️ `file://${process.argv[1]}` を文字列で組み立てて比べないこと
   （standards/lib/cli-entry.test.mjs が字面で見張っている）。 */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code));
}
