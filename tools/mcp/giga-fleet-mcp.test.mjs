/**
 * giga-fleet-mcp.mjs の試験。
 *
 * ⚠️ 手書きの JSON-RPC なので、プロトコルの形そのものを見る。
 *    SDK を入れていないぶん、ここが唯一の受け止めになる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, callTool, handle } from './giga-fleet-mcp.mjs';

/** handle() が send する内容を捕まえる */
function captured(msg) {
  const out = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(s); return true; };
  try { handle(msg); } finally { process.stdout.write = write; }
  return out.map((s) => JSON.parse(s));
}

test('initialize に serverInfo と tools の能力を返す', () => {
  const [res] = captured({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, 'giga-fleet');
  assert.ok(res.result.capabilities.tools);
});

test('通知（id が無い）には返さない（返すとプロトコル違反）', () => {
  assert.deepEqual(captured({ jsonrpc: '2.0', method: 'notifications/initialized' }), []);
});

test('tools/list が 4 つの道具を返す', () => {
  const [res] = captured({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(res.result.tools.map((t) => t.name).sort(),
    ['fleet_status', 'fleet_todo', 'invariant_violations', 'repo_gaps']);
});

test('道具にはすべて inputSchema がある（無いと呼べない）', () => {
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, 'object', `${t.name} に inputSchema がない`);
    assert.ok(t.description.length > 40, `${t.name} の description が短すぎる`);
  }
});

test('知らない method には -32601 を返す', () => {
  const [res] = captured({ jsonrpc: '2.0', id: 3, method: 'なにこれ' });
  assert.equal(res.error.code, -32601);
});

test('知らない道具は isError で返す（例外で落とさない）', () => {
  const [res] = captured({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(res.result.isError, true);
  assert.ok(res.result.content[0].text.includes('知らない道具'));
});

test('repo_gaps: 手元に無いものは「調べていない」と言う（きれい、ではない）', () => {
  const text = callTool('repo_gaps', { repo: 'ぜったいに無いリポジトリ' });
  assert.ok(text.includes('調べていない'), text);
});

test('repo_gaps: repo を渡さなければ、そう言う', () => {
  assert.ok(callTool('repo_gaps', {}).includes('repo を指定'));
});

test('invariant_violations: 推定であることと生成日を必ず添える', () => {
  const out = JSON.parse(callTool('invariant_violations'));
  assert.ok(out.generatedAt, '生成日が無い');
  assert.ok(out._note.includes('推定'), '推定であることを言っていない');
  assert.ok(out._note.includes('verify-runtime'), '実測の道具を案内していない');
});

test('fleet_status: unmeasured を「きれい」と読ませない注記がある', () => {
  const out = JSON.parse(callTool('fleet_status'));
  assert.ok(Array.isArray(out.measured));
  assert.ok(out._note.includes('調べていない'));
});
