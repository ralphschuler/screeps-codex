#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
try {
  const server = createServer();
  await server.connect(new StdioServerTransport());
} catch {
  console.error('Screeps MCP could not start. Check configuration.');
  process.exitCode = 1;
}
