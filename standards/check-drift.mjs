#!/usr/bin/env node
/**
 * 正本（standards/）とのずれ検知。
 *
 *   node check-drift.mjs --standards <standardsディレクトリ>
 *
 * 実行するリポジトリの直下にある standards-map.json を読み、
 * 正本とローカルコピーを照合する。ずれていたら一覧を出して落ちる。
 *
 * アプリ固有の値（APP_ID など）は normalize で両側をプレースホルダーに
 * そろえてから比べる。「1行だけ変えてよい」を機械で言い切るための仕組み。
 */
import fs from 'node:fs';
import path from 'node:path';

const NORMALIZERS = {
  // APP_ID の定義行と、テストデータ内の appId 値を許す
  'app-id': (s) => s
    .replace(/(APP_ID\s*=\s*)['"][^'"]*['"]/g, "$1'__APP_ID__'")
    .replace(/(appId:\s*)['"][^'"]*['"]/g, "$1'__APP_ID__'"),
  // records-export.js の置き場（js/ か public/ か）の違いを許す
  'records-export-import': (s) => s
    .replace(/from\s+['"][^'"]*records-export\.js['"]/g, "from '__RECORDS_EXPORT_PATH__'"),
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const standardsDir = arg('--standards');
if (!standardsDir) {
  console.error('使い方: node check-drift.mjs --standards <standardsディレクトリ>');
  process.exit(2);
}

const mapPath = path.resolve('standards-map.json');
if (!fs.existsSync(mapPath)) {
  console.log('[drift] standards-map.json が無いので照合するものがありません（このリポジトリは正本コピーを持ちません）');
  process.exit(0);
}

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const entries = Array.isArray(map.files) ? map.files : [];
if (entries.length === 0) {
  console.log('[drift] standards-map.json の files が空です');
  process.exit(0);
}

const drifted = [];
for (const { canonical, local, normalize = [] } of entries) {
  const cPath = path.join(standardsDir, canonical);
  const lPath = path.resolve(local);
  if (!fs.existsSync(cPath)) { drifted.push(`${local}: 正本 ${canonical} が standards/ にありません`); continue; }
  if (!fs.existsSync(lPath)) { drifted.push(`${local}: ローカルコピーがありません（standards/${canonical} からコピーしてください）`); continue; }
  let c = fs.readFileSync(cPath, 'utf8');
  let l = fs.readFileSync(lPath, 'utf8');
  for (const n of normalize) {
    const fn = NORMALIZERS[n];
    if (!fn) { drifted.push(`${local}: 未知の normalize "${n}"`); continue; }
    c = fn(c); l = fn(l);
  }
  if (c !== l) drifted.push(`${local}: 正本 standards/${canonical} とずれています`);
}

if (drifted.length) {
  console.error('❌ 正本とのずれを検知しました:');
  for (const d of drifted) console.error('  - ' + d);
  console.error('');
  console.error('直し方: 正本（GIGAyama.github.io/standards/）を先に直してから各リポジトリへコピーします。');
  console.error('このリポジトリ側だけを直すと、他のコピーにその修正が届きません。');
  process.exit(1);
}
console.log(`✅ 正本と一致しています（${entries.length} ファイル）`);
