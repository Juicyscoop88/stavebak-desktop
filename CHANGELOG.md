# Seznam změn

Důležité změny Stavebák Desktop.

## [0.16.1] - 2026-10-30

### Opraveno
- Pole pro zprávu už nevyjíždí pod otevřený pravý panel Stav projektu, tlačítko odeslání zůstává u chatu.

## [0.16.0] - 2026-10-29

### Přidáno
- Poznámky k projektu jako jednoduchý editor pro projektanty: nadpisy, tučné písmo, zvýraznění, odrážky a úkoly, nápovědy pod každým oddílem a plovoucí menu nad označeným textem. Soubor zůstává Markdown, asistent ho čte jako dřív.
- Postup projektu a srozumitelné názvy technických souborů v postranním panelu.
- Tlačítko Nahlásit problém v horní liště vedle aktualizace: otevře předvyplněné hlášení s verzí, systémem a případnou chybou, bez názvu a cesty projektu.

### Opraveno
- Smazání projektu na Windows a macOS (přesun do Koše) už nekončí chybou, když složku drží otevřenou aplikace nebo chybí oprávnění Finderu. Dialog ukáže celý text chyby.

## [0.15.0] - 2026-10-27

### Přidáno
- ChatGPT přes Codex jako druhý asistent vedle Clauda: výběr asistenta v Nastavení → Účty, API klíč OpenAI v klíčence, instalace Codexu z oficiálního vydání OpenAI. Přihlášení účtem ChatGPT je zatím jen ve vývojovém buildu.

### Opraveno
- Přihlášení do Clauda v úvodním průvodci otevře prohlížeč (`claude auth login`). Když se přihlášení nespustí, průvodce to řekne a nabídne přihlášení v terminálu.
- Chat funguje i bez účtu Stavebák a po zkušební době, účet odemyká jen nástroje Stavebáku.
- Náhled DXF se obnoví po změně souboru, náhled DWG ukazuje průběh a ukládá se do mezipaměti.

## [0.14.2] - 2026-10-26

### Opraveno
- Historie konverzací najde projekty ve složkách s diakritikou a na Windows.

### Změněno
- Vydání pro macOS i Windows vzniká celé v CI (podpis a notarizace macOS), aktualizace mají jeden manifest pro obě platformy.

## [0.14.1] - 2026-10-25

### Opraveno
- Jednotné logo Stavebáku v Docku, v aplikaci i ve všech ikonách. Dock na macOS už nepřepisuje původní logo TOKENICODE.

## [0.14.0] - 2026-10-25

### Změněno
- Claude Code běží jen s přihlášením uživatele: `claude login` (účet Claude) nebo jeho vlastní API klíč. Nastavení vlastních API poskytovatelů je pryč.
- Aplikace nezasahuje do přihlašovacího toku Claude Code (obnovu tokenu ani jiné požadavky, které neobsluhuje, neodmítá, jen je vrátí jako nepodporované).
- Názvy konverzací se ukládají v `~/.stavebak`, ne v `~/.claude`.

### Bezpečnost
- Aplikace nikdy nečte soubory s přihlašovacími údaji (`~/.claude/.credentials.json`, `~/.codex/auth.json`).

## [0.13.0] - 2026-10-23
- První vydání pod vlastní řadou verzí.
