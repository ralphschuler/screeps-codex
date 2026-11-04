#!/usr/bin/env node
import { runtimeEnvironment } from './runtime.mjs';
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required (24 recommended).');
  const env = await runtimeEnvironment();
  for (const key of ['SCREEPS_TOKEN', 'SCREEPS_SHARD', 'SCREEPS_WRITES', 'SCREEPS_WRITE_BRANCHES', 'SCREEPS_CONSOLE']) {
    if (env[key] !== undefined) process.env[key] = env[key];
  }
  await import('../dist/server.mjs');
} catch (error) {
  // runtime errors are deliberately generic and never include subprocess output.
  console.error('Screeps MCP setup: ' + error.message);
  process.exitCode = 1;
}
