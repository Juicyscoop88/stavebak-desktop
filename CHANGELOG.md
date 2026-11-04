# Seznam změn

Důležité změny Stavebák Desktop.

## [0.17.0] - 2026-11-04

### Přidáno
- Aplikace se aktualizuje sama. Novou verzi stáhne na pozadí a po spuštění ji rovnou nainstaluje. Během práce počká, až asistent nic nedělá a nikde není rozepsaná zpráva, pak se po krátkém odpočtu restartuje. Projekty i konverzace zůstanou. Když aktualizace selže, jde ji zkusit znovu, stáhnout ručně, nebo zatím pokračovat ve staré verzi.

### Opraveno
- V užším okně (např. na půl monitoru) s otevřeným náhledem souboru nebo Postupem projektu zůstane chat čitelný. Panely se zúží a po roztažení okna se vrátí na původní šířku.

## [0.16.2] - 2026-11-02

### Opraveno
- Stavebák se v dlouhé konverzaci už neodpojuje. Přihlášení se obnovuje samo i po hodinách nebo přes víkend a výpadek sítě uživatele neodhlásí. Když přihlášení opravdu chybí, asistent poradí přihlásit se v aplikaci a lišta nahoře nabídne přihlášení. Po přihlášení funguje konverzace dál bez restartu.
- Projekt ze seznamu jde smazat i tehdy, když se v aplikaci od spuštění neotevřel (na Windows končilo chybou „outside the allowed workspace“).
- Vložený snímek obrazovky nebo jiný soubor jde odeslat i bez textu (Enter i tlačítko Odeslat). Dokud se vložený snímek ukládá, zpráva neodejde bez něj.
- Horní lišta chatu v úzkém okně s vysunutým levým panelem: název konverzace a Nové téma už nezajíždějí pod tlačítko aktualizace, dlouhý název se zkrátí.

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
