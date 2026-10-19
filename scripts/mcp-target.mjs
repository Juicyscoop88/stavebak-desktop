#!/usr/bin/env node
// Point the `stavebak` MCP server (in ~/.claude.json, read by Claude Code and the desktop)
// at the local dev server or production.  Usage: node scripts/mcp-target.mjs local|prod|status
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TARGETS = {
  local: 'http://localhost:3535/mcp',
  prod: 'https://stavebak.cz/mcp',
};

const target = process.argv[2] ?? 'status';
const path = join(homedir(), '.claude.json');
const config = JSON.parse(readFileSync(path, 'utf8'));
const current = config.mcpServers?.stavebak?.url;

if (target === 'status') {
  const name = Object.entries(TARGETS).find(([, url]) => url === current)?.[0] ?? 'custom';
  console.log(`stavebak → ${current ?? '(not configured)'} [${name}]`);
  process.exit(0);
}
if (!TARGETS[target]) {
  console.error('Usage: node scripts/mcp-target.mjs local|prod|status');
  process.exit(1);
}

config.mcpServers ??= {};
config.mcpServers.stavebak = { type: 'streamable-http', ...config.mcpServers.stavebak, url: TARGETS[target] };
writeFileSync(path, JSON.stringify(config, null, 2));
console.log(`stavebak → ${TARGETS[target]} [${target}]`);
if (target === 'local') {
  console.log('Running sessions keep their old server: start a new conversation (or restart the app) to pick it up.');
}
