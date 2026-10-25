# User flows (use casy)

Co musí projektant v aplikaci zvládnout od prvního spuštění po platbu. Každý flow má automatický test
(`scripts/e2e-flows.mjs`, harness proti lokálnímu serveru) nebo ruční krok, kde je potřeba člověk.

Lokálně se přihlášení obejde bez člověka: server s `OAUTH_DEV_LOGIN=1` přihlásí rovnou (prohlížeč se jen
otevře a sám se vrátí). Člověk je potřeba jen u skutečného Google přihlášení a platby proti produkci.

| # | Flow | Jak se ověřuje |
|---|---|---|
| F1 | **První spuštění bez účtu Stavebák**: úvod vysvětlí Claude a Stavebák, krok Stavebák nejde přeskočit, po přihlášení „Zkušební měsíc do …“ | automaticky (skutečné přihlášení přes dev login) |
| F2 | **Stav účtu v nastavení**: zkušební měsíc s datem, Koupit Pro, Odhlásit | automaticky |
| F3 | **Otevření projektu**: panel Přehled načte kroky ze serveru (guide) pod účtem, žádné „nejde načíst“ | automaticky |
| F4 | **Náhled DWG**: soubor v projektu se nahraje a převede na serveru (request_upload, convert_drawing) pod účtem, bez chyby přihlášení | automaticky |
| F5 | **Konverzace**: dotaz na stavbu, model zavolá Stavebák (classify_project) a odpoví s citací | automaticky (skutečný Claude, stojí tokeny) |
| F6 | **Odhlášení a návrat**: brána „Přihlaste se do Stavebáku“, po přihlášení zpět do aplikace | automaticky |
| F7 | **Konec zkušební doby**: lišta posledních 5 dní, obrazovka s platbou, Koupit Pro otevře Stripe Checkout | automaticky stav (podstrčený), odkaz na Checkout skutečný |
| F8 | **Platba**: Stripe Checkout testovací kartou 4242…, po návratu do okna tarif Pro | ručně (člověk v prohlížeči) |
| F9 | **Produkce s Googlem**: release build, přihlášení skutečným Google účtem | ručně (člověk) |
| F10 | **Aktualizace**: nainstalovaná starší verze nabídne novou, po restartu běží | ručně |

## Spuštění

```bash
# lokální server (repo stavebak.cz, .env.local s OAUTH_DEV_LOGIN=1 a Stripe sandboxem)
node scripts/dev-env.mjs up
# debug build s harnessem (čeká na „Test harness registered“)
pnpm tauri dev
# všechny automatické flows, screenshoty do docs/snapshots/flows/ (gitignored)
node scripts/e2e-flows.mjs           # bez F5 (bez tokenů)
WITH_CLAUDE=1 node scripts/e2e-flows.mjs
```

Ruční kroky (F8 až F10) jsou na konci výstupu skriptu jako checklist.
