#!/usr/bin/env node
/**
 * 教訓が、ちゃんと検査に落ちているかを見る。
 *
 *   node tools/check-lessons.mjs
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * この艦隊は「障害を文書で終わらせず検査に落とす」ことでできている。
 * ところが**その落とし込みが済んでいるかどうかを見る仕組みが無かった。**
 * SYSTEM_MASTER.md の表は人が読む文章なので、
 *
 *   ・検査を書いたつもりで書いていない
 *   ・検査は在るが、名前を変えたあと表のほうが古い
 *   ・似た型の穴が別の場所に残っている
 *
 * のどれも、読んだ人が気づくまで分からない。
 *
 * 実際 2026-08-29 に、2026-08-28 の「.agents/skills が無検査だった」と
 * **まったく同じ型**が .agents/rules に残っているのが見つかった。
 * この台帳が先に在れば「skills は塞いだが rules は？」として自動で浮いていた。
 *
 * ── 2 つ見る。②が本体 ────────────────────────────────
 *
 *   ① guardedBy も unguarded も無い教訓 … 落とし込みが済んでいない
 *   ② 書いた検査が実在しない教訓       … **本体**
 *
 * ②が本体である理由。「検査 ID を書いたが実在しない」は、この艦隊が
 * 繰り返し踏んでいる型そのものだから（2026-08-28 の giga-reviewer は
 * 検査項目に『タップ領域』『SW版数』と書いてあったが、実装が無かった）。
 * 台帳が嘘をつくと、台帳があるぶんだけ事故が見えにくくなる。
 *
 * ⚠️ unguarded は「見張れていない」の宣言であって、免除ではない。
 *    理由を書かせるのは、あとから読んだ人が「これは諦めたのか、
 *    まだ手を付けていないのか」を判断できるようにするため。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/**
 * 台帳そのものの不備を返す（読み込みの前に形を見る）。
 * @returns {string[]} 空なら不備なし
 */
export function ledgerProblems(ledger) {
  const problems = [];
  const rows = Array.isArray(ledger?.lessons) ? ledger.lessons : null;
  if (!rows) return ['lessons の一覧がありません'];
  if (rows.length === 0) return ['lessons が空です（教訓が 1 件も無いはずはありません）'];

  rows.forEach((l, i) => {
    const where = l?.date ? `${l.date}` : `${i + 1} 件目`;
    if (!l?.date) problems.push(`${where}: date がありません`);
    if (!l?.symptom) problems.push(`${where}: symptom（何が起きたか）がありません`);

    const guards = Array.isArray(l?.guardedBy) ? l.guardedBy : [];
    const unguarded = typeof l?.unguarded === 'string' ? l.unguarded.trim() : '';

    if (guards.length === 0 && !unguarded) {
      problems.push(
        `${where}: guardedBy も unguarded もありません`
        + '（見張っている検査を書くか、見張れていないなら理由つきで unguarded に書いてください）',
      );
    }
    if (guards.length > 0 && unguarded) {
      problems.push(`${where}: guardedBy と unguarded の両方があります（どちらかにしてください）`);
    }
    guards.forEach((g, j) => {
      if (!g?.file || !g?.contains) problems.push(`${where}: guardedBy[${j}] に file と contains が要ります`);
    });
  });
  return problems;
}

/**
 * 書いた検査が実在するかを、実際にファイルを読んで確かめる。
 *
 * ⚠️ ID の表を別に持たない。持つと、検査の名前を変えたときに
 *    表のほうが古くなり、「在ることになっているが無い」が生まれる。
 *    実物を読んで文字列が在るかを見る。
 *
 * @returns {string[]} 空なら全部実在する
 */
export function missingGuards(ledger, root = REPO_ROOT, deps = {}) {
  const { exists = fs.existsSync, read = fs.readFileSync } = deps;
  const problems = [];
  for (const l of ledger.lessons ?? []) {
    for (const g of l.guardedBy ?? []) {
      if (!g?.file || !g?.contains) continue;   // 形の不備は ledgerProblems の担当
      const abs = path.join(root, g.file);
      if (!exists(abs)) {
        problems.push(`${l.date}: ${g.file} がありません（見張っていることになっているが、ファイルが無い）`);
        continue;
      }
      let body;
      try { body = read(abs, 'utf8'); }
      catch (e) { problems.push(`${l.date}: ${g.file} を読めません: ${e.message}`); continue; }
      if (!body.includes(g.contains)) {
        problems.push(
          `${l.date}: ${g.file} に「${g.contains}」がありません`
          + '（検査の名前が変わったか、消えています。台帳のほうが古くなっています）',
        );
      }
    }
  }
  return problems;
}

/** 見張れていない教訓の一覧（落としはしないが、必ず見せる） */
export function unguardedLessons(ledger) {
  return (ledger.lessons ?? [])
    .filter((l) => typeof l.unguarded === 'string' && l.unguarded.trim())
    .map((l) => ({ date: l.date, symptom: l.symptom, reason: l.unguarded }));
}

function main() {
  const p = path.join(REPO_ROOT, 'docs/architecture/lessons.json');
  if (!fs.existsSync(p)) {
    console.error('❌ docs/architecture/lessons.json がありません');
    return 1;
  }
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`❌ lessons.json を読めません: ${e.message}`); return 1; }

  const shape = ledgerProblems(ledger);
  const missing = missingGuards(ledger);

  if (shape.length) {
    console.error(`❌ 台帳そのものに不備が ${shape.length} 件:`);
    for (const s of shape) console.error('  - ' + s);
  }
  if (missing.length) {
    console.error(`❌ 書いてある検査が実在しないものが ${missing.length} 件:`);
    for (const m of missing) console.error('  - ' + m);
    console.error('');
    console.error('台帳が嘘をつくと、台帳があるぶんだけ事故が見えにくくなります。');
    console.error('検査を直したなら台帳も直し、検査を消したなら unguarded へ移してください。');
  }
  if (shape.length || missing.length) return 1;

  const total = ledger.lessons.length;
  const un = unguardedLessons(ledger);
  console.log(`✅ 教訓 ${total} 件。書いてある検査はすべて実在します（${total - un.length} 件が見張られています）`);
  if (un.length) {
    console.log(`\n⚠️ 機械で見張れていない教訓が ${un.length} 件あります（免除ではなく、宣言です）:`);
    for (const u of un) {
      console.log(`  - ${u.date} ${u.symptom.slice(0, 44)}…`);
      console.log(`      ${u.reason}`);
    }
  }
  return 0;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exit(main());
