import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/server.js';
import { ScreepsClient, fingerprint, decodeMemory } from '../src/client.js';

async function setup(t, env = {}, request = async () => ({ ok: 1 })) {
  const server = createServer({ env, client: { request } });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const enabled = { SCREEPS_WRITES: 'true', SCREEPS_WRITE_BRANCHES: 'test' };
const body = { main: 'module.exports.loop = () => {};' };
const payload = { branch: 'test', modules: body, expectedFingerprint: fingerprint(body), confirm: true };
test('default mode exposes seven read tools and no writes', async t => {
  const c = await setup(t);
  const { tools } = await c.listTools();
  assert.equal(tools.length, 7);
  assert.ok(tools.every(x => x.annotations.readOnlyHint));
  const status = JSON.parse((await c.callTool({ name: 'screeps_status', arguments: {} })).content[0].text);
  assert.equal(status.tokenConfigured, false);
  assert.equal(status.writesEnabled, false);
});
test('write mode exposes scoped writes, not console', async t => {
  const c = await setup(t, enabled);
  const { tools } = await c.listTools();
  assert.equal(tools.length, 11);
  assert.ok(!tools.some(x => x.name === 'screeps_console'));
});
test('console requires both explicit switches', async t => {
  const c = await setup(t, { ...enabled, SCREEPS_CONSOLE: 'true' });
  assert.ok((await c.listTools()).tools.find(x => x.name === 'screeps_console').annotations.destructiveHint);
});
test('branch allowlist blocks before network access', async t => {
  const c = await setup(t, enabled, () => assert.fail('No request expected'));
  const r = await c.callTool({ name: 'screeps_replace_code', arguments: { ...payload, branch: 'main' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not in/);
});
test('active branch cannot silently bypass protection', async t => {
  let calls = 0;
  const c = await setup(t, enabled, async () => { calls++; return { list: [{ branch: 'test', activeWorld: true }] }; });
  const r = await c.callTool({ name: 'screeps_replace_code', arguments: payload });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /active/);
  assert.equal(calls, 1);
});
test('stale fingerprint blocks write', async t => {
  const c = await setup(t, enabled, async (p, o) => {
    assert.notEqual(o?.method, 'POST');
    return p.endsWith('branches') ? { list: [{ branch: 'test' }] } : { modules: { main: 'changed' } };
  });
  const r = await c.callTool({ name: 'screeps_replace_code', arguments: payload });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Code changed/);
});
test('approved code replacement posts only API fields', async t => {
  let posted;
  const c = await setup(t, enabled, async (p, o) => {
    if (o?.method === 'POST') { posted = o.body; return { ok: 1 }; }
    return p.endsWith('branches') ? { list: [{ branch: 'test' }] } : { modules: body };
  });
  const r = await c.callTool({ name: 'screeps_replace_code', arguments: payload });
  assert.ok(!r.isError);
  assert.deepEqual(posted, { branch: 'test', modules: body });
});
test('unsafe memory path and root writes are rejected', async t => {
  const c = await setup(t, enabled, () => assert.fail('No request expected'));
  for (const path of ['', '__proto__.x', 'foo.constructor', "x\\'];Game.notify('x')//"]) {
    const r = await c.callTool({ name: 'screeps_set_memory', arguments: { path, value: 1, confirm: true } });
    assert.equal(r.isError, true);
  }
});
test('missing confirmation and extra fields fail validation', async t => {
  const c = await setup(t, enabled, () => assert.fail('No request expected'));
  for (const args of [{ branch: 'test', activeName: 'activeWorld' }, { branch: 'test', activeName: 'activeWorld', confirm: true, endpoint: 'https://evil.test' }]) {
    const r = await c.callTool({ name: 'screeps_activate_branch', arguments: args });
    assert.equal(r.isError, true);
  }
});
test('memory writes carry explicit shard and omit confirmation', async t => {
  let sent;
  const c = await setup(t, enabled, async (p, o) => { sent = o.body; return { ok: 1 }; });
  await c.callTool({ name: 'screeps_set_memory', arguments: { path: 'settings.mode', value: 'defense', confirm: true } });
  assert.deepEqual(sent, { shard: 'shard3', path: 'settings.mode', value: 'defense' });
});
test('memory decoder supports gz and plain JSON', () => {
  assert.deepEqual(decodeMemory('gz:' + gzipSync('{"x":1}').toString('base64')), { x: 1 });
  assert.deepEqual(decodeMemory('{"x":1}'), { x: 1 });
  assert.equal(fingerprint({ a: '1', b: '2' }), fingerprint({ b: '2', a: '1' }));
});
test('HTTP sends token only to fixed origin, prevents redirects', async () => {
  const client = new ScreepsClient({ token: 'fake-test-token', fetchImpl: async (u, o) => {
    assert.equal(u.origin, 'https://screeps.com');
    assert.ok(!u.href.includes('fake-test-token'));
    assert.equal(o.headers['X-Token'], 'fake-test-token');
    assert.equal(o.redirect, 'error');
    return new Response('{"ok":1}');
  } });
  assert.deepEqual(await client.request('/api/auth/me'), { ok: 1 });
  await assert.rejects(client.request('https://evil.test/api/auth/me'), /Invalid/);
});
test('missing token fails without network request', async () => {
  const c = new ScreepsClient({ fetchImpl: () => assert.fail('No request') });
  await assert.rejects(c.request('/api/auth/me'), /not configured/);
});
test('429 does not retry or leak remote response body', async () => {
  let calls = 0;
  const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => { calls++; return new Response('sensitive', { status: 429 }); } });
  await assert.rejects(c.request('/api/user/code', { method: 'POST', body: {} }), /rate limit/);
  assert.equal(calls, 1);
});
test('failed write reports uncertain outcome and does not retry', async () => {
  let calls = 0;
  const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => { calls++; throw new Error('secret'); } });
  await assert.rejects(c.request('/api/user/code', { method: 'POST' }), /outcome unknown/);
  assert.equal(calls, 1);
});
test('remote application errors are sanitized', async () => {
  const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => new Response('{"error":"fake secret"}') });
  await assert.rejects(c.request('/api/auth/me'), { message: 'Screeps API rejected the request.' });
});
test('bundled server negotiates MCP over stdio without credentials', async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/server.mjs'], env: {}, stderr: 'pipe' });
  const c = new Client({ name: 'integration-test', version: '1.0.0' });
  t.after(() => c.close());
  await c.connect(transport);
  assert.equal((await c.listTools()).tools.length, 7);
  const r = await c.callTool({ name: 'screeps_me', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not configured/);
});
test('invalid JSON after a write is an uncertain outcome', async () => {
  const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => new Response('not json') });
  await assert.rejects(c.request('/api/user/code', { method: 'POST' }), /outcome unknown/);
});
test('large responses are bounded and sanitized', async () => {
  const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => new Response('x'.repeat(9 * 1024 * 1024)) });
  await assert.rejects(c.request('/api/auth/me'), /size limit/);
});
test('decompression bombs are bounded', () => {
  const encoded = gzipSync(' '.repeat(9 * 1024 * 1024)).toString('base64');
  assert.throws(() => decodeMemory('gz:' + encoded));
});
test('segments enforce IDs and bytes before requests', async t => {
  const c = await setup(t, enabled, () => assert.fail('No request expected'));
  for (const args of [
    { segment: 100, data: '', confirm: true },
    { segment: 0, data: 'é'.repeat(52000), confirm: true }
  ]) assert.equal((await c.callTool({ name: 'screeps_set_segment', arguments: args })).isError, true);
});
test('malformed success envelopes never report accepted writes', async () => {
  for (const body of ['{}', '[]', 'null', '{"ok":true}']) {
    const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => new Response(body) });
    await assert.rejects(c.request('/api/user/code', { method: 'POST' }), /outcome unknown/);
  }
});
test('stream failure after response headers is sanitized and uncertain', async () => {
  const c = new ScreepsClient({ token: 'fake', fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('transport-private-detail')); }
  })) });
  await assert.rejects(c.request('/api/user/code', { method: 'POST' }), {
    message: 'Write outcome unknown: response could not be read. Inspect Screeps state before retrying.'
  });
});
test('writes are serialized so another write cannot interleave its preflight', async t => {
  const events = [];
  const c = await setup(t, enabled, async (p, o) => {
    events.push(o.body.branch);
    await new Promise(resolve => setTimeout(resolve, 20));
    events.push('done');
    return { ok: 1 };
  });
  await Promise.all([1, 2].map(() => c.callTool({
    name: 'screeps_activate_branch', arguments: { branch: 'test', activeName: 'activeWorld', confirm: true }
  })));
  assert.deepEqual(events, ['test', 'done', 'test', 'done']);
});
