#!/usr/bin/env node
// Přegeneruje všechny rastrové ikony z jediného zdroje brand/icon.svg.
// Použití: pnpm brand (potřebuje ImageMagick `magick` s podporou SVG).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

const svg = readFileSync(join(root, 'brand/icon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// Šablona Apple: tělo ikony 824 px na plátně 1024 px, okolí průhledné (macOS Dock).
const padded = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<g transform="translate(100 100) scale(8.24)">${inner}</g></svg>`;

const tmp = mkdtempSync(join(tmpdir(), 'stavebak-brand-'));
try {
  const source = join(tmp, 'icon.svg');
  const png = join(tmp, 'icon-1024.png');
  writeFileSync(source, padded);
  run('magick', ['-background', 'none', '-density', '384', source, '-resize', '1024x1024', png]);
  run('pnpm', ['exec', 'tauri', 'icon', png]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
copyFileSync(join(root, 'brand/icon.svg'), join(root, 'public/favicon.svg'));
console.log('Hotovo: src-tauri/icons/* a public/favicon.svg přegenerovány z brand/icon.svg');
