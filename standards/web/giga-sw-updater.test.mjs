import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(HERE, 'giga-sw-updater.js');

test('giga-sw-updater.js: 正本ファイルが存在し空でない', () => {
  assert.ok(fs.existsSync(SCRIPT_PATH), 'giga-sw-updater.js が存在すること');
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.length > 1000, '十分なコード長があること');
});

test('giga-sw-updater.js: 児童向けルビが含まれている', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.includes('<ruby>新<rt>あたら</rt></ruby>しい'), '「新しい」のルビがあること');
  assert.ok(code.includes('<ruby>更新<rt>こうしん</rt></ruby>する'), '「更新する」のルビがあること');
});

test('giga-sw-updater.js: 外部CDNへの参照が含まれていない（自己完結）', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(!code.includes('https://cdnjs'), 'cdnjs への参照がないこと');
  assert.ok(!code.includes('https://cdn.jsdelivr'), 'jsdelivr への参照がないこと');
  assert.ok(!code.includes('https://fonts.googleapis'), 'Google Fonts への参照がないこと');
});

test('giga-sw-updater.js: 48px 以上のタップ領域がスタイルされている', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.includes('min-height: 48px'), 'ボタンの最小高さが 48px 以上であること');
});

test('giga-sw-updater.js: SKIP_WAITING と controllerchange 連携が含まれている', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.includes("SKIP_WAITING"), 'SKIP_WAITING postMessage が含まれること');
  assert.ok(code.includes("controllerchange"), 'controllerchange リスナーが含まれること');
});
