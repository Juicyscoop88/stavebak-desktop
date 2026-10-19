#!/usr/bin/env node
// Local dev environment for desktop + Stavebák MCP. Safe to run any time (idempotent).
//   node scripts/dev-env.mjs up      start local MCP server if needed, point `stavebak` at it
//   node scripts/dev-env.mjs status  what is running and where `stavebak` points
//   node scripts/dev-env.mjs down    point `stavebak` back at production, stop the local server
import { spawn, execSync } from 'node:child_process';
import { openSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVER_REPO = join(homedir(), 'Projects', 'stavebak.cz');
const HEALTH = 'http://localhost:3535/health';
const LOG = '/tmp/stavebak-mcp.log';
const TARGET = join(import.meta.dirname, 'mcp-target.mjs');

const healthy = async () => {
  try { return (await fetch(HEALTH, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
};
const target = (arg) => execSync(`node "${TARGET}" ${arg}`, { encoding: 'utf8' }).trim();
const pid = () => {
  try { return execSync('lsof -ti tcp:3535 -sTCP:LISTEN', { encoding: 'utf8' }).trim() || null; } catch { return null; }
};

const cmd = process.argv[2] ?? 'status';

if (cmd === 'up') {
  if (!(await healthy())) {
    if (!existsSync(SERVER_REPO)) throw new Error(`Server repo not found: ${SERVER_REPO}`);
    const out = openSync(LOG, 'a');
    // --watch: restarts on every code change, so server edits apply without a deploy
    spawn('node', ['--watch', '--import', 'tsx', 'server/index.ts'], {
      cwd: SERVER_REPO, detached: true, stdio: ['ignore', out, out],
    }).unref();
    for (let i = 0; i < 30 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await healthy())) throw new Error(`Local server did not start, see ${LOG}`);
    console.log(`local server started (log: ${LOG})`);
  } else {
    console.log('local server already running');
  }
  console.log(target('local'));
} else if (cmd === 'down') {
  console.log(target('prod'));
  const p = pid();
  if (p) { execSync(`kill ${p}`); console.log('local server stopped'); }
} else if (cmd === 'status') {
  console.log(`local server: ${(await healthy()) ? `running (pid ${pid()}, log ${LOG})` : 'not running'}`);
  console.log(target('status'));
} else {
  console.error('Usage: node scripts/dev-env.mjs up|status|down');
  process.exit(1);
}
