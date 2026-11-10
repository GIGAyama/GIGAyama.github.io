#!/usr/bin/env node
/**
 * 正本の配布に使うトークン（PAT_TOKEN）が、もうすぐ切れないかを見る。
 *
 *   PAT_TOKEN=… node tools/check-pat-expiry.mjs [--warn-days 14]
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 正本の自動配布は、リポジトリをまたげるトークン 1 つに乗っている
 * （docs/operations/pat-token.md）。切れると 43 本ぜんぶが 403 で落ちるが、
 * **切れる前には何も起きない**。気づくのは、正本を直して配ろうとした日になる。
 * その日は直したい不具合が手元にある日で、いちばん止まってほしくない。
 *
 * GitHub は、期限つきのトークンで API を叩くと、応答の見出し
 * `github-authentication-token-expiration` に期限を入れて返す。それを読むだけ。
 *
 * ── 終わりかた ────────────────────────────────────────
 *
 *   exit 0  期限まで warn-days より長い ／ 期限の無いトークン
 *   exit 1  もうすぐ切れる ／ 切れている・無効 ／ 設定されていない ／ 期限を読めない
 *
 * ⚠️ トークンそのものは 1 字も出さない。出すのは期限の日付だけ。
 */
import { pathToFileURL } from 'node:url';

export const EXPIRY_HEADER = 'github-authentication-token-expiration';

/**
 * 見出しの値を時刻にする。読めなければ null。
 * 形は `2026-11-27 08:15:27 UTC` か `2026-11-27 08:15:27 +0900`。
 */
export function parseExpiry(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const zone = !m[3] || m[3] === 'UTC' || m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
  const at = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * @param {{status: number, header: string|null|undefined, now: Date, warnDays?: number}} p
 * @returns {{ok: boolean, message: string, daysLeft?: number}}
 */
export function expiryVerdict({ status, header, now, warnDays = 14 }) {
  if (status === 401) {
    return { ok: false, message: 'PAT_TOKEN が切れているか、無効です（HTTP 401）。正本の配布は 1 本も成立しません。' };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, message: `GitHub に確かめられませんでした（HTTP ${status}）。期限は分かっていません。` };
  }
  if (header === null || header === undefined || String(header).trim() === '') {
    /* 期限なしのトークンは、この見出しを返さない。分かるのは「期限が書かれていない」まで */
    return { ok: true, message: 'PAT_TOKEN は有効です。期限の見出しはありません（期限なしのトークン）。' };
  }
  const at = parseExpiry(header);
  if (!at) {
    return { ok: false, message: `期限の見出しを読めませんでした（${JSON.stringify(String(header))}）。形が変わっています。` };
  }
  const daysLeft = Math.floor((at.getTime() - now.getTime()) / 86400000);
  const date = at.toISOString().slice(0, 10);
  if (daysLeft < 0) return { ok: false, daysLeft, message: `PAT_TOKEN は ${date} に切れています。` };
  if (daysLeft <= warnDays) {
    return { ok: false, daysLeft, message: `PAT_TOKEN があと ${daysLeft} 日で切れます（${date}）。切れると正本の配布が 1 本も成立しません。` };
  }
  return { ok: true, daysLeft, message: `PAT_TOKEN は有効です。期限は ${date}（あと ${daysLeft} 日）。` };
}

async function main() {
  const i = process.argv.indexOf('--warn-days');
  const warnDays = i >= 0 ? Number(process.argv[i + 1]) : 14;
  if (!Number.isFinite(warnDays) || warnDays < 0) { console.error('--warn-days には 0 以上の数を渡してください'); return 2; }

  const token = process.env.PAT_TOKEN;
  const HOW = '直し方: docs/operations/pat-token.md（作りなおして、Secret の PAT_TOKEN を入れ替える）';
  if (!token) {
    console.error('❌ PAT_TOKEN が設定されていません。正本の配布は 1 本も成立しません。');
    console.error(HOW);
    return 1;
  }
  const repo = process.env.GITHUB_REPOSITORY || 'GIGAyama/GIGAyama.github.io';
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'giga-check-pat-expiry', authorization: `Bearer ${token}` },
  });
  const verdict = expiryVerdict({ status: res.status, header: res.headers.get(EXPIRY_HEADER), now: new Date(), warnDays });
  if (verdict.ok) { console.log(`✅ ${verdict.message}`); return 0; }
  console.error(`❌ ${verdict.message}`);
  console.error(HOW);
  return 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code))
    .catch((error) => { console.error(`❌ GitHub に確かめられませんでした: ${error.message}`); process.exit(1); });
}
