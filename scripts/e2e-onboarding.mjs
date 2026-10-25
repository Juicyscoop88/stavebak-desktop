#!/usr/bin/env node
// E2E onboardingu a brány účtu přes GUI harness (spec 098 v repu serveru). Běží proti debug buildu
// (`pnpm tauri dev`), každou obrazovku ověří textem a vyfotí do docs/snapshots/onboarding/ (gitignored).
// Stav účtu se podstrčí přes window.__stavebak_test.account, server ani přihlášení netřeba.
// Použití: node scripts/e2e-onboarding.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const OUT = 'docs/snapshots/onboarding';
mkdirSync(OUT, { recursive: true });

const cli = (...args) => JSON.parse(execFileSync('node', ['scripts/stavebak-cli.mjs', ...args], { encoding: 'utf8' }).trim().split('\n').pop());
const exec = (code) => cli('exec', code);
const delay = (ms) => cli('delay', String(ms));
const visibleText = () => cli('get-visible-text').text ?? '';

let failed = 0;
function step(name, expect, setup) {
  setup();
  delay(400);
  const text = visibleText();
  const missing = expect.filter((e) => !text.includes(e));
  const shot = cli('screenshot').path;
  copyFileSync(shot, `${OUT}/${name}.png`);
  console.log(`${missing.length ? 'FAIL' : 'ok  '} ${name}${missing.length ? `  chybí: ${missing.join(' | ')}` : ''}`);
  if (missing.length) failed++;
}

const t = '(window).__stavebak_test';
cli('ping');

step('1-welcome', ['Vítejte ve Stavebáku', 'Claude je umělá inteligence', '30 dní zdarma'],
  () => exec(`${t}.previewOnboarding('welcome')`));
step('2-claude', ['Máte předplatné Claude?', 'Stavebák běží na vašem Claude'],
  () => exec(`${t}.previewOnboarding('claude')`));
step('3-stavebak', ['Přihlaste se do Stavebáku', '30 dní všechny funkce zdarma', 'Pokračovat přes Google'],
  () => exec(`${t}.previewOnboarding('stavebak')`));
step('4-done', ['Vše je připraveno'],
  () => exec(`${t}.previewOnboarding('done')`));

// Po onboardingu: brána účtu podle tarifu. Krátká pauza, ať doběhne načtení skutečného stavu po startu.
exec(`${t}.setSetupCompleted(true)`);
delay(1500);
step('5-trial-ending', ['Zkušební měsíc končí', 'Koupit Pro'],
  () => exec(`${t}.account({ signedIn: true, plan: 'trial', daysLeft: 3 })`));
step('6-expired', ['Zkušební měsíc skončil', 'Pro za 990 Kč měsíčně', 'Pro za 9 900 Kč ročně'],
  () => exec(`${t}.account({ signedIn: true, plan: 'free', daysLeft: 0 })`));
step('7-signed-out', ['Stavebák bez účtu nefunguje', 'Pokračovat přes Google'],
  () => exec(`${t}.account({ signedIn: false })`));
step('8-pro', [],
  () => exec(`${t}.account({ signedIn: true, plan: 'pro' })`));
const proText = visibleText();
if (proText.includes('Zkušební měsíc skončil') || proText.includes('Zkušební měsíc končí')) {
  console.log('FAIL 8-pro  u Pro nemá být brána ani lišta');
  failed++;
}

console.log(failed ? `\n${failed} selhání, screenshoty v ${OUT}` : `\nvše v pořádku, screenshoty v ${OUT}`);
process.exit(failed ? 1 : 0);
