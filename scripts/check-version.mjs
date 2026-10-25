#!/usr/bin/env node
// Verze aplikace musí sedět v package.json, src-tauri/tauri.conf.json a src-tauri/Cargo.toml
// (mění je scripts/bump-version.sh). S argumentem tagu (v1.2.3) musí sedět i s ním.
// Použití: node scripts/check-version.mjs [vX.Y.Z]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');

const versions = {
  'package.json': JSON.parse(read('package.json')).version,
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml': read('src-tauri/Cargo.toml').match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m)?.[1],
};

const tag = process.argv[2];
if (tag) versions[`tag ${tag}`] = tag.replace(/^v/, '');

const distinct = new Set(Object.values(versions));
if (distinct.size !== 1 || distinct.has(undefined)) {
  for (const [file, version] of Object.entries(versions)) console.error(`  ${file}: ${version ?? 'nenalezena'}`);
  console.error('Verze nesedí. Opravit přes scripts/bump-version.sh X.Y.Z.');
  process.exit(1);
}
console.log(`Verze ${[...distinct][0]} sedí (${Object.keys(versions).join(', ')}).`);
