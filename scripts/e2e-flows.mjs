#!/usr/bin/env node
// E2E user flows (docs/user-flows.md) přes GUI harness proti debug buildu a lokálnímu serveru s dev loginem.
// Každý krok ověří stav (účet, texty, chyby) a vyfotí okno do docs/snapshots/flows/ (gitignored).
// Použití: node scripts/e2e-flows.mjs   (WITH_CLAUDE=1 i konverzace se skutečným modelem)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'docs/snapshots/flows';
mkdirSync(OUT, { recursive: true });
const DWG_SAMPLE = process.env.DWG_SAMPLE ?? `${process.env.HOME}/Documents/Stavebák/aaa/random.dwg`;

const cli = (...args) => JSON.parse(execFileSync('node', ['scripts/stavebak-cli.mjs', ...args], { encoding: 'utf8', timeout: 400_000 }).trim().split('\n').pop());
const t = (call) => cli('exec', `window.__stavebak_test.${call}`).result;
const sleep = (ms) => cli('delay', String(ms));
const text = () => cli('get-visible-text').text ?? '';
/** Screenshot nesmí shodit test (screencapture občas selže), jeden pokus navíc. */
function shot(name) {
  for (let i = 0; i < 2; i++) {
    try { copyFileSync(cli('screenshot').path, `${OUT}/${name}.png`); return; } catch { sleep(800); }
  }
  console.log(`     (screenshot ${name} se nepovedl)`);
}

// DEMO=ms: pauza po každém kroku, aby se dal běh sledovat očima (např. DEMO=2500)
const DEMO = Number(process.env.DEMO ?? 0);
let failed = 0;
const results = [];
function check(flow, name, ok, detail = '') {
  results.push({ flow, name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${flow} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
  if (DEMO) sleep(DEMO);
}
/** Čeká, až podmínka platí (polling harnessu), vrací poslední hodnotu. */
function waitFor(fn, timeoutMs = 30_000, stepMs = 700) {
  const end = Date.now() + timeoutMs;
  let v;
  while (Date.now() < end) {
    v = fn();
    if (v) return v;
    sleep(stepMs);
  }
  return v;
}

cli('ping');

// F1: první spuštění bez účtu Stavebák → úvod → krok Stavebák → skutečné přihlášení (dev login) → hotovo
t('stavebakLogout()');
t('setSetupCompleted(false)');
cli('exec', 'location.reload()');
sleep(2500);
check('F1', 'úvod se ukáže bez účtu', waitFor(() => text().includes('Vítejte ve Stavebáku'), 20_000));
shot('F1-1-welcome');
t("clickText('Začít')");
check('F1', 'po úvodu krok Stavebák (Claude je přihlášený)', waitFor(() => text().includes('Přihlaste se do Stavebáku')));
check('F1', 'krok Stavebák nejde přeskočit', !text().includes('Přeskočit'));
shot('F1-2-stavebak');
t("clickText('Pokračovat přes Google')");
check('F1', 'přihlášení doběhne (dev login)', waitFor(() => text().includes('Vše je připraveno'), 60_000));
const afterLogin = t('accountSnapshot()');
check('F1', 'účet má zkušební měsíc', afterLogin?.signedIn === true && afterLogin?.plan === 'trial', JSON.stringify(afterLogin));
check('F1', 'hotovo ukazuje konec zkušební doby', text().includes('Zkušební měsíc, všechny funkce do'));
shot('F1-3-done');
t("clickText('Pokračovat')");
sleep(1500);

// F2: stav účtu v nastavení
t('openSettings()');
sleep(1200);
check('F2', 'nastavení ukazuje zkušební měsíc', waitFor(() => text().includes('Zkušební měsíc, všechny funkce do'), 15_000));
check('F2', 'Koupit Pro a Odhlásit', text().includes('Koupit Pro') && text().includes('Odhlásit'));
shot('F2-settings');
t('closeSettings()');

// F3: otevření projektu, Přehled pod účtem
const dir = mkdtempSync(join(tmpdir(), 'stavebak-flow-'));
writeFileSync(join(dir, 'stavebak.json'), JSON.stringify({ version: '1', nazev: 'Rodinný dům (test flow)', typ_stavby: 'rd', parameters: {}, checklist: {} }, null, 2));
const hasDwg = existsSync(DWG_SAMPLE);
if (hasDwg) copyFileSync(DWG_SAMPLE, join(dir, 'situace.dwg'));
t(`newSession(${JSON.stringify(dir)})`);
sleep(3000);
const overview = waitFor(() => { const s = text(); return /nejde načíst|vyžaduje účet/i.test(s) ? 'error' : /krok|Přehled|Zadání|Podklad/i.test(s) ? 'ok' : null; }, 25_000);
check('F3', 'Přehled projektu se načetl ze serveru', overview === 'ok', overview === 'error' ? 'chyba načtení nebo přihlášení' : '');
shot('F3-project');

// F4: náhled DWG (nahrání a převod na serveru pod účtem)
if (hasDwg) {
  t(`openFile(${JSON.stringify(join(dir, 'situace.dwg'))})`);
  const dwg = waitFor(() => { const s = text(); return /nejste přihlášen|vyžaduje účet|not authenticated/i.test(s) ? 'auth' : /převod selhal|nepodařilo/i.test(s) ? 'error' : hasCanvas() ? 'ok' : null; }, 60_000, 1500);
  check('F4', 'DWG se převede a zobrazí bez chyby přihlášení', dwg === 'ok', dwg ?? 'timeout');
  shot('F4-dwg');
  t('closePreview()');
} else {
  check('F4', `vzorový DWG (${DWG_SAMPLE})`, false, 'soubor neexistuje, nastav DWG_SAMPLE');
}
function hasCanvas() {
  return cli('exec', "!!document.querySelector('canvas')").result === true;
}

// F5: konverzace se skutečným Claude (volitelné, stojí tokeny)
if (process.env.WITH_CLAUDE) {
  cli('type', 'Jaká je kategorie novostavby rodinného domu se dvěma nadzemními podlažími? Odpověz stručně s citací.');
  cli('send');
  cli('wait-until-done', '--timeout', '300000');
  const msgs = t('getMessages({ last: 6 })');
  const all = JSON.stringify(msgs);
  check('F5', 'model zavolal Stavebák (classify_project)', /classify_project/.test(all));
  check('F5', 'odpověď s kategorií a citací', /jednoduch/i.test(all) && /283\/2021|příl/i.test(all));
  check('F5', 'žádná chyba přihlášení v nástrojích', !/vyžaduje účet|401|Authenticate/i.test(all));
  shot('F5-chat');
}

// F6: odhlášení → brána → přihlášení zpět
t('stavebakLogout()');
check('F6', 'po odhlášení brána', waitFor(() => text().includes('Stavebák bez účtu nefunguje'), 10_000));
shot('F6-1-signed-out');
t("clickText('Pokračovat přes Google')");
check('F6', 'po přihlášení zpět do aplikace', waitFor(() => !text().includes('Stavebák bez účtu nefunguje') && t('accountSnapshot()')?.signedIn === true, 60_000));
shot('F6-2-back');

// F7: konec zkušební doby (stav podstrčený, odkaz na platbu skutečný ze serveru)
t("account({ signedIn: true, plan: 'trial', daysLeft: 3 })");
check('F7', 'lišta posledních dní', waitFor(() => text().includes('Zkušební měsíc končí'), 5000));
shot('F7-1-ending');
t("account({ signedIn: true, plan: 'free', daysLeft: 0 })");
check('F7', 'obrazovka s platbou', waitFor(() => text().includes('Zkušební měsíc skončil'), 5000));
shot('F7-2-expired');
t('accountRefresh()');
check('F7', 'po obnovení skutečný stav (zkušební měsíc)', waitFor(() => t('accountSnapshot()')?.plan === 'trial', 15_000));

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} kontrol v pořádku, screenshoty v ${OUT}`);
console.log(`
Ruční kroky (člověk):
  F8  Nastavení → Koupit Pro → Stripe Checkout, karta 4242 4242 4242 4242, návrat do okna → tarif Pro
  F9  Release build (Aplikace) proti produkci: přihlášení skutečným Google účtem, zkušební měsíc
  F10 Starší verze z Aplikací → Nastavení → Zkontrolovat aktualizace → nová verze, restart`);
process.exit(failed ? 1 : 0);
