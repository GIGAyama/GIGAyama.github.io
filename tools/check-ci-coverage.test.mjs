/**
 * 「書いたテストが呼ばれているか」を見る検査の、そのまた試験。
 *
 * 2026-11-10: CI から呼ばれていないテストが 2 本あった。うち 1 本は教訓の台帳が
 * 見張り役として名指ししていたもの。ここが崩れると、同じ形がまた黙って残る。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testPatterns, globToRe, uncovered } from './check-ci-coverage.mjs';

test('run: の 1 行からも、複数行の run: からも拾う', () => {
  const yaml = [
    '      - name: a',
    '        run: node --test standards/lib/*.test.mjs',
    '      - name: b',
    '        run: |',
    '          node --test tools/check-lessons.test.mjs',
    '          node tools/check-lessons.mjs',
    '      - run: node --test tools/a.test.mjs tools/b.test.mjs',
  ].join('\n');
  assert.deepEqual(testPatterns(yaml), [
    'standards/lib/*.test.mjs', 'tools/check-lessons.test.mjs', 'tools/a.test.mjs', 'tools/b.test.mjs',
  ]);
});

test('コメントに書いただけでは、呼んだことにしない', () => {
  const yaml = '      # ⚠️ node --test tools/x.test.mjs を足すこと\n      - run: echo hi  # node --test tools/y.test.mjs';
  assert.deepEqual(testPatterns(yaml), []);
});

test('検査そのもの（node tools/x.mjs）は、テストを呼んだことにしない', () => {
  assert.deepEqual(testPatterns('run: node tools/check-lessons.mjs'), []);
});

test('* は 1 階層ぶんにだけ効く', () => {
  const re = globToRe('tools/lib/*.test.mjs');
  assert.ok(re.test('tools/lib/gh.test.mjs'));
  assert.ok(!re.test('tools/lib/deep/gh.test.mjs'));
  assert.ok(!re.test('tools/gh.test.mjs'));
  assert.ok(globToRe('standards/skills/*/scripts/*.test.mjs').test('standards/skills/giga-manual/scripts/lint-manual.test.mjs'));
});

test('. は「どの 1 字でも」ではなく、点そのもの', () => {
  assert.ok(!globToRe('tools/a.test.mjs').test('tools/aXtest.mjs'));
});

test('呼ばれていないテストを名指しする（2026-11-10 の形）', () => {
  const yaml = 'run: node --test tools/lib/gh.test.mjs\nrun: node --test standards/skills/note-article/scripts/lint-article.test.mjs';
  const tests = [
    'tools/lib/gh.test.mjs',
    'tools/lib/distribute-regenerate.test.mjs',
    'standards/skills/note-article/scripts/lint-article.test.mjs',
    'standards/skills/note-article/scripts/capture.test.mjs',
  ];
  assert.deepEqual(uncovered(tests, [yaml]), [
    'tools/lib/distribute-regenerate.test.mjs',
    'standards/skills/note-article/scripts/capture.test.mjs',
  ]);
});

test('どれか 1 つのワークフローが呼んでいれば足りる', () => {
  assert.deepEqual(uncovered(['a/x.test.mjs'], ['run: echo', 'run: node --test a/*.test.mjs']), []);
});
