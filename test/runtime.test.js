import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeEnvironment, readRuntimeConfiguration } from '../scripts/runtime.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const options = config => ({
  env: { PLUGIN_DATA: '/fake-data' }, uid: 1000,
  readConfiguration: async () => JSON.stringify(config),
  execute: async () => assert.fail('No credential lookup allowed')
});
test('missing configuration performs no credential lookup', async () => {
  assert.deepEqual(await runtimeEnvironment({ env: {}, execute: () => assert.fail() }), {});
});
test('missing runtime file is normal', async () => {
  const config = await runtimeEnvironment({ ...options({}), readConfiguration: async () => { const e = new Error(); e.code = 'ENOENT'; throw e; } });
  assert.equal(config.SCREEPS_TOKEN, undefined);
});
test('reject token fields and writable configuration', async () => {
  await assert.rejects(runtimeEnvironment(options({ token: 'not-a-real-token' })), /non-secret/);

});
test('read-only settings are preserved explicitly', async () => {
  const env = await runtimeEnvironment(options({ writes: false, console: false, shard: 'shard2', writeBranches: ['test'] }));
  assert.equal(env.SCREEPS_WRITES, 'false');
  assert.equal(env.SCREEPS_CONSOLE, 'false');
  assert.equal(env.SCREEPS_SHARD, 'shard2');
  assert.equal(env.SCREEPS_WRITE_BRANCHES, 'test');
});
test('Keychain lookup requires explicit choice and uses fixed service', async () => {
  let calls = 0;
  const env = await runtimeEnvironment({ ...options({ credentialSource: 'macos-keychain', keychainAccount: 'player' }), platform: 'darwin',
    execute: async (cmd, args, opts) => {
      calls++; assert.equal(cmd, '/usr/bin/security');
      assert.deepEqual(args, ['find-generic-password', '-s', 'screeps-codex', '-a', 'player', '-w']);
      assert.equal(opts.timeout, 15000);
      return { stdout: 'synthetic-token\n' };
    } });
  assert.equal(calls, 1); assert.equal(env.SCREEPS_TOKEN, 'synthetic-token');
});
test('Keychain errors never disclose stderr or secret output', async () => {
  await assert.rejects(runtimeEnvironment({ ...options({ credentialSource: 'macos-keychain' }), platform: 'darwin',
    execute: async () => { throw new Error('SECRET'); } }), e => !e.message.includes('SECRET') && /designated/.test(e.message));
});
test('Keychain cannot run on non-macOS platforms', async () => {
  await assert.rejects(runtimeEnvironment({ ...options({ credentialSource: 'macos-keychain' }), platform: 'linux' }), /requires macOS/);
});
test('Unix launcher negotiates MCP without credentials or runtime config', async t => {
  const transport = new StdioClientTransport({ command: './scripts/launch.sh', env: {}, stderr: 'pipe' });
  const client = new Client({ name: 'launcher-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.callTool({ name: 'screeps_status', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).tokenConfigured, false);
  assert.equal((await client.listTools()).tools.length, 7);
});

test('runtime config validates directory, regular file, ownership and symlinks', async t => {
  const { mkdtemp, writeFile, chmod, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'screeps-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'runtime.json');
  await writeFile(path, '{}', { mode: 0o600 });
  assert.equal(await readRuntimeConfiguration(dir), '{}');
  await chmod(path, 0o666);
  await assert.rejects(readRuntimeConfiguration(dir), /Unsafe/);
  await chmod(path, 0o600);
  await chmod(dir, 0o777);
  await assert.rejects(readRuntimeConfiguration(dir), /Unsafe/);
  await chmod(dir, 0o700);
  await rm(path);
  await writeFile(join(dir, 'other.json'), '{}', { mode: 0o600 });
  await symlink(join(dir, 'other.json'), path);
  await assert.rejects(readRuntimeConfiguration(dir));
});
