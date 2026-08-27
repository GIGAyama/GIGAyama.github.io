#!/usr/bin/env node
/**
 * =====================================================================
 * capture-scenarios.mjs — AIシナリオ駆動型 スクリーンショット自動撮影ツール
 * =====================================================================
 * 
 * 使用法:
 *   node tools/capture-scenarios.mjs --repo Ice_slide-puzzle
 *   node tools/capture-scenarios.mjs --all
 *   node tools/capture-scenarios.mjs --check-only
 * 
 * 概要:
 *   各アプリの `docs/ui-scenarios.json` に定義された操作シナリオを読み込み、
 *   Playwright で実際に操作して高品質なアセット画像（紹介用スクショ・OGP）を自動生成する。
 * =====================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BASE_DIR = path.resolve(REPO_ROOT, '..');

const args = process.argv.slice(2);
const isCheckOnly = args.includes('--check-only');
const repoIdx = args.indexOf('--repo');
const targetRepo = repoIdx !== -1 ? args[repoIdx + 1] : null;

// シンプルな静的ファイルサーバー
function createStaticServer(rootDir, port = 0) {
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json'
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';

    const filePath = path.join(rootDir, reqPath);
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({ server, port: actualPort });
    });
  });
}

async function runScenarioCapture(repoName) {
  const repoDir = path.join(BASE_DIR, repoName);
  const scenarioFile = path.join(repoDir, 'docs', 'ui-scenarios.json');

  if (!fs.existsSync(scenarioFile)) {
    console.log(`[SKIP] No ui-scenarios.json found in ${repoName}`);
    return;
  }

  const spec = JSON.parse(fs.readFileSync(scenarioFile, 'utf-8'));
  console.log(`\n📷 [${repoName}] Processing ${spec.scenarios.length} scenarios...`);

  if (isCheckOnly) {
    console.log(`  [OK] Valid scenario definition found (${spec.scenarios.length} scenarios).`);
    return;
  }

  // Playwright の動的インポート
  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch (e) {
    console.warn(`\n⚠️ Playwright がインストールされていません。`);
    console.warn(`   撮影を実行するには 'npx playwright install' を実行してください。`);
    return;
  }

  const { server, port } = await createStaticServer(repoDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: spec.viewport || { width: 1280, height: 720 },
    deviceScaleFactor: 2 // 高解像度Retina対応
  });
  const page = await context.newPage();

  try {
    const appUrl = `http://127.0.0.1:${port}/index.html`;
    await page.goto(appUrl, { waitUntil: 'networkidle' });

    for (const scenario of spec.scenarios) {
      console.log(`  ▶ Running scenario: ${scenario.title} (${scenario.id})`);

      // 操作アクションの実行
      if (Array.isArray(scenario.actions)) {
        for (const act of scenario.actions) {
          if (act.type === 'click') {
            await page.click(act.selector);
          } else if (act.type === 'type') {
            await page.fill(act.selector, act.text || '');
          } else if (act.type === 'wait') {
            await page.waitForTimeout(act.ms || 500);
          } else if (act.type === 'eval') {
            await page.evaluate(act.code);
          } else if (act.type === 'hover') {
            await page.hover(act.selector);
          }
        }
      }

      // スクリーンショット撮影
      const outPath = path.join(repoDir, scenario.capture.output);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      if (scenario.capture.selector) {
        const el = await page.$(scenario.capture.selector);
        if (el) {
          await el.screenshot({ path: outPath });
          console.log(`    ✅ Saved element capture -> ${scenario.capture.output}`);
        } else {
          console.warn(`    ⚠️ Element not found: ${scenario.capture.selector}`);
        }
      } else {
        await page.screenshot({ path: outPath, fullPage: !!scenario.capture.fullPage });
        console.log(`    ✅ Saved screen capture -> ${scenario.capture.output}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  if (targetRepo) {
    await runScenarioCapture(targetRepo);
  } else {
    // 全リポジトリ探索
    const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'GIGAyama.github.io' && !entry.name.startsWith('.')) {
        await runScenarioCapture(entry.name);
      }
    }
  }
}

main().catch(console.error);
