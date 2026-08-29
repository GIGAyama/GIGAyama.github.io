#!/usr/bin/env node
/**
 * 艦隊の状態を「道具」として出す MCP サーバ（stdio）。
 *
 *   node tools/mcp/giga-fleet-mcp.mjs      ← 直接は叩かない。.mcp.json 経由で起動される
 *
 * ── なぜスクリプトの薄い皮なのか ────────────────────
 *
 * 中身は tools/fleet-status.mjs と同じものを呼ぶだけ。**正本はスクリプト側**に置く。
 * 逆順（先に MCP を作る）だと、正本を持たないラッパだけが増えて、
 * 「fleet-status を直したのに MCP は古いまま」という食い違いができる。
 *
 * MCP の利点は「エージェントが自然に道具として選ぶ」ことで、機能ではない。
 * 人が打つなら fleet-status を直接叩けばよい。
 *
 * ── 依存を足さない ──────────────────────────────────
 *
 * ⚠️ @modelcontextprotocol/sdk を入れない。ポータルには package.json も
 *    node_modules も無く、それは意図してそうなっている（配信物に実行時依存を
 *    持ちこまない、という方針の一部）。SDK を 1 つ入れると、その性質が壊れる。
 *    stdio の MCP は「改行区切りの JSON-RPC 2.0」でしかないので手で書く。
 *    使うのは initialize / tools/list / tools/call の 3 つだけ。
 *
 * ⚠️ 標準出力に JSON-RPC 以外を書かないこと。1 行でも混ざると、
 *    相手はプロトコル違反として接続を切る。ログは標準エラーへ。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fleetRepos, buildStatus, inspectRepo, todoLines, cdnViolations,
} from '../fleet-status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const BASE_DIR = path.resolve(REPO_ROOT, '..');

const read = (p) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, p), 'utf8'));
const status = () => {
  const ledger = read('tools/distribution.json');
  const apps = read('data/apps.json');
  return buildStatus(fleetRepos(ledger), apps, (r) => inspectRepo(path.join(BASE_DIR, r)));
};

/** 道具の一覧。description は「いつ使うか」を書く（何をするか、ではなく） */
export const TOOLS = [
  {
    name: 'fleet_status',
    description:
      '艦隊 42 本の持ちもの（v5 ゲート・SW版数・CLAUDE.md・hook・npm run check）を 1 回で返す。'
      + '「どのリポジトリに何が入っているか」を知りたいとき。1 本ずつ歩くより速く、文脈も埋まらない。'
      + '手元に無くて調べられなかったものは unmeasured に入る（合格として数えない）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'invariant_violations',
    description:
      'Zero-CDN（第一原則）に違反しているアプリと、読んでいる外部ホストを返す。'
      + '⚠️ data/apps.json の推定（配布ファイルの静的解析）なので、生成日を必ず添えて返す。'
      + '実測が要るなら tools/verify-runtime.mjs を実ブラウザで走らせること。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'fleet_todo',
    description:
      '次に直すべきものを「違反 → 直し方 → 使う正本の道具」の形で返す。'
      + '「何から手を付けるか」を決めたいときに、これだけ読めばよい形にしてある。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'repo_gaps',
    description:
      '1 本のリポジトリに何が入っていて何が無いか（v5 ゲート・quality.config.json・'
      + 'SW版数生成・standards-map.json・CLAUDE.md・hook・npm run check / test）を返す。'
      + '移行の前後で使う。手元に無ければ「調べていない」と返す（きれい、ではない）。',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'リポジトリ名（例: Typa）' } },
      required: ['repo'],
      additionalProperties: false,
    },
  },
];

/** 道具を実行して、返す文字列を作る */
export function callTool(name, args = {}) {
  if (name === 'fleet_status') {
    const s = status();
    return JSON.stringify({
      measured: s.measured, unmeasured: s.unmeasured,
      _note: 'unmeasured は「手元に無くて調べていない」。きれい、ではない',
    }, null, 2);
  }
  if (name === 'invariant_violations') {
    const apps = read('data/apps.json');
    return JSON.stringify({
      generatedAt: apps.generatedAt ?? '不明',
      _note: '配布ファイルの静的解析からの推定。実行時に組み立てられる URL は見えない。'
        + '実測は tools/verify-runtime.mjs',
      violations: cdnViolations(apps),
    }, null, 2);
  }
  if (name === 'fleet_todo') {
    const s = status();
    const lines = todoLines(s);
    return lines.length ? lines.join('\n\n') : '作業待ちはありません。';
  }
  if (name === 'repo_gaps') {
    const repo = String(args.repo ?? '');
    if (!repo) return 'repo を指定してください。';
    const info = inspectRepo(path.join(BASE_DIR, repo));
    if (info === null) return `${repo} は手元にありません（調べていない、であって、きれい、ではありません）。`;
    return JSON.stringify({ repo, ...info }, null, 2);
  }
  throw new Error(`知らない道具です: ${name}`);
}

/* ── JSON-RPC 2.0（改行区切り）────────────────────── */

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

export function handle(msg) {
  const { id, method, params } = msg;
  // 通知（id が無い）には返さない。返すとプロトコル違反になる
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'giga-fleet', version: '1.0.0' },
    });
  }
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const text = callTool(params?.name, params?.arguments ?? {});
      return ok(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `失敗しました: ${e.message}` }], isError: true });
    }
  }
  return err(id, -32601, `知らない method です: ${method}`);
}

function main() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); }
      catch { continue; }   // 読めない行は黙って捨てる（標準出力を汚さない）
      try { handle(msg); }
      catch (e) { process.stderr.write(`giga-fleet-mcp: ${e.message}\n`); }
    }
  });
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]).endsWith('giga-fleet-mcp.mjs');
if (invokedDirectly) main();
