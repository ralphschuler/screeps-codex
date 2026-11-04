import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ScreepsClient, fingerprint, decodeMemory } from './client.js';

const branch = z.string().min(1).max(30).regex(/^[a-zA-Z0-9_.-]+$/);
const shard = z.string().regex(/^shard[0-9]+$/);
const path = z.string().max(256).regex(/^(?:[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)?$/)
  .refine(v => !v.split('.').some(p => ['__proto__', 'constructor', 'prototype'].includes(p)), 'Unsafe memory path');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const modules = z.record(z.string().min(1).max(100).regex(/^[a-zA-Z0-9_./-]+$/), z.string())
  .refine(v => Object.keys(v).length > 0 && Buffer.byteLength(JSON.stringify(v)) <= 5 * 1024 * 1024, 'Code must contain modules and fit within 5 MiB');
const confirm = z.literal(true).describe('Set only after user approval for this exact operation. This field is not a security boundary.');
export function createServer({ env = process.env, client = new ScreepsClient({ token: env.SCREEPS_TOKEN }) } = {}) {
  const server = new McpServer({ name: 'screeps-codex', version: '0.1.0' });
  const writes = env.SCREEPS_WRITES === 'true';
  const consoleEnabled = writes && env.SCREEPS_CONSOLE === 'true';
  const allowedBranches = new Set((env.SCREEPS_WRITE_BRANCHES || '').split(',').map(s => s.trim()).filter(Boolean));
  const defaultShard = shard.parse(env.SCREEPS_SHARD || 'shard3');
  let queue = Promise.resolve();
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  function tool(name, description, schema, fn, write = false) {
    server.registerTool(name, {
      description, inputSchema: z.object(schema).strict(),
      annotations: { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write, openWorldHint: true }
    }, async args => {
      try {
        const value = await (write ? serial(() => fn(args)) : fn(args));
        return { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        const message = String(error.message).split(env.SCREEPS_TOKEN || '\0').join('[REDACTED]');
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    });
  }
  function permitBranch(value) {
    if (!allowedBranches.has(value)) throw new Error('Branch is not in SCREEPS_WRITE_BRANCHES.');
  }
  const shardSchema = shard.default(defaultShard);
  tool('screeps_status', 'Read local configuration without revealing credentials.', {}, async () => ({
    tokenConfigured: Boolean(env.SCREEPS_TOKEN), writesEnabled: writes, consoleEnabled,
    writeBranches: [...allowedBranches], defaultShard, endpoint: 'https://screeps.com',
    runtimeDataDirectory: env.PLUGIN_DATA || null
  }));
  tool('screeps_me', 'Read the authenticated Screeps account.', {}, () => client.request('/api/auth/me'));
  tool('screeps_branches', 'List code branches and active flags.', {}, () => client.request('/api/user/branches'));
  tool('screeps_code', 'Read named branch modules and SHA-256 fingerprint. Save these modules before replacing.', { branch }, async a => {
    const result = await client.request('/api/user/code', { query: a });
    if (!result.modules || typeof result.modules !== 'object') throw new Error('Unexpected code response.');
    return { ...result, fingerprint: fingerprint(result.modules) };
  });
  tool('screeps_memory', 'Read decoded memory for a shard and optional dotted path.', { shard: shardSchema, path: path.default('') }, async a => {
    const result = await client.request('/api/user/memory', { query: a });
    return { ...result, data: decodeMemory(result.data) };
  });
  tool('screeps_segment', 'Read a memory segment.', { shard: shardSchema, segment: z.number().int().min(0).max(99) },
    a => client.request('/api/user/memory-segment', { query: a }));
  tool('screeps_terrain', 'Read room terrain.', { shard: shardSchema, room: z.string().regex(/^[WE][0-9]+[NS][0-9]+$/) },
    a => client.request('/api/game/room-terrain', { query: { ...a, encoded: 1 } }));
  if (writes) {
    tool('screeps_replace_code', 'Replace ALL modules on an allowlisted branch. Omitted modules are deleted. Requires current fingerprint; active branches also require allowActive. API lacks atomic compare-and-swap, so pause other deployers.', {
      branch, modules, expectedFingerprint: hash, allowActive: z.boolean().default(false), confirm
    }, async a => {
      permitBranch(a.branch);
      const branches = await client.request('/api/user/branches');
      const target = branches.list?.find(b => b.branch === a.branch);
      if (!target) throw new Error('Target branch does not exist.');
      if ((target.activeWorld || target.activeSim) && !a.allowActive) throw new Error('Target is active. Explicit allowActive is required.');
      const current = await client.request('/api/user/code', { query: { branch: a.branch } });
      if (fingerprint(current.modules) !== a.expectedFingerprint) throw new Error('Code changed. Read current code and review again.');
      const result = await client.request('/api/user/code', { method: 'POST', body: { branch: a.branch, modules: a.modules } });
      return { ...result, submittedFingerprint: fingerprint(a.modules), note: 'Request accepted. Read code again to verify persisted content.' };
    }, true);
    tool('screeps_set_memory', 'Set memory at a non-root dotted path. Applied by game execution; read back after a tick. Root replacement is deliberately unavailable.', {
      shard: shardSchema, path: path.refine(v => v.length > 0, 'Root replacement is disabled'),
      value: z.json().refine(v => Buffer.byteLength(JSON.stringify(v)) <= 1024 * 1024, 'Memory value too large'), confirm
    }, ({ confirm: _, ...a }) => client.request('/api/user/memory', { method: 'POST', body: a }), true);
    tool('screeps_set_segment', 'Replace one memory segment (up to 100 KiB). Read the previous value and obtain approval first.', {
      shard: shardSchema, segment: z.number().int().min(0).max(99),
      data: z.string().refine(v => Buffer.byteLength(v) <= 100 * 1024, 'Segment too large'), confirm
    }, ({ confirm: _, ...a }) => client.request('/api/user/memory-segment', { method: 'POST', body: a }), true);
    tool('screeps_activate_branch', 'Activate an allowlisted code branch for world or simulation. This changes executing code.', {
      branch, activeName: z.enum(['activeWorld', 'activeSim']), confirm
    }, ({ confirm: _, ...a }) => {
      permitBranch(a.branch);
      return client.request('/api/user/set-active-branch', { method: 'POST', body: a });
    }, true);
  }
  if (consoleEnabled) tool('screeps_console', 'Execute arbitrary game JavaScript. High risk: can change memory, destroy game assets, trade or send messages. Review exact expression and consequences with user first. No sandbox or per-expression authorization is enforced by this server.', {
    shard: shardSchema, expression: z.string().min(1).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 1024, 'Expression too large'), confirm
  }, ({ confirm: _, ...a }) => client.request('/api/user/console', { method: 'POST', body: a }), true);
  return server;
}
