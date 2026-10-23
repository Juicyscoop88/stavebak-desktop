#!/usr/bin/env node
// Local Stavebák MCP server for development. Safe to run any time (idempotent).
//   node scripts/dev-env.mjs up      start the local MCP server (localhost:3535) if not running
//   node scripts/dev-env.mjs status  is it running
//   node scripts/dev-env.mjs down    stop it
// Nothing is switched: a dev build of the app (`pnpm tauri dev`) always talks to the local server,
// a release build to production, STAVEBAK_MCP_URL overrides both (see stavebak_mcp_target in lib.rs).
// The user's ~/.claude.json is never touched.
import { spawn, execSync } from 'node:child_process';
import { openSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVER_REPO = join(homedir(), 'Projects', 'stavebak.cz');
const HEALTH = 'http://localhost:3535/health';
const LOG = '/tmp/stavebak-mcp.log';

const healthy = async () => {
  try { return (await fetch(HEALTH, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
};
const pid = () => {
  try { return execSync('lsof -ti tcp:3535 -sTCP:LISTEN', { encoding: 'utf8' }).trim() || null; } catch { return null; }
};

const cmd = process.argv[2] ?? 'status';

if (cmd === 'up') {
  if (!(await healthy())) {
    if (!existsSync(SERVER_REPO)) throw new Error(`Server repo not found: ${SERVER_REPO}`);
    const out = openSync(LOG, 'a');
    // The server repo owns how it starts and is configured; dev:watch restarts on every code change
    spawn('npm', ['run', 'dev:watch'], {
      cwd: SERVER_REPO, detached: true, stdio: ['ignore', out, out],
    }).unref();
    for (let i = 0; i < 30 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await healthy())) throw new Error(`Local server did not start, see ${LOG}`);
    console.log(`local server started (log: ${LOG})`);
  } else {
    console.log('local server already running');
  }
} else if (cmd === 'down') {
  const p = pid();
  if (p) { execSync(`kill ${p}`); console.log('local server stopped'); }
} else if (cmd === 'status') {
  console.log(`local server: ${(await healthy()) ? `running (pid ${pid()}, log ${LOG})` : 'not running'}`);
} else {
  console.error('Usage: node scripts/dev-env.mjs up|status|down');
  process.exit(1);
}
