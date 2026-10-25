# Seznam změn

Důležité změny Stavebák Desktop.

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
