---
status: approved
date: 2026-11-08
summary: Vlastní computer use: lokální MCP server, kterým model ovládá aplikace uživatele, vedle neupravené binárky Claude Code
---

# Ovládání aplikací z asistenta (#70)

## Podnět

Projektant chce dát asistentovi povolení, aby v BricsCADu pracoval sám. V aplikaci Claude to funguje, ve Stavebák Desktop ne.

## Proč vlastní server

Windows binárka Claude Code 2.1.319 obsahuje `throw Error("@ant/computer-use-swift is only available on macOS")` a žádné volání Windows pro vstup. Vestavěné computer use na Windows umí jen aplikace Claude, na tarifech Pro, Max a Ultra. Binárka ale načítá MCP servery, desktop jí předává `--mcp-config` pro každou session. Vlastní server tedy binárku nemění a použije ho i případný vlastní harness.

## Co je hotové

| Soubor | Co dělá |
|---|---|
| `src-tauri/src/computer_use.rs` | Pravidla a nástroje nad traitem `Desktop`, JSON-RPC |
| `src-tauri/src/computer_use_native.rs` | Okna a snímky (xcap), myš a klávesnice (enigo), popředí |
| `src-tauri/src/computer_use_server.rs` | HTTP na loopbacku se stejnými ochranami jako `mcp_bridge` |

Nástroje: `computer_list_apps`, `computer_request_access`, `computer_screenshot`, `computer_click`, `computer_type`, `computer_key`, `computer_scroll`.

## Ochrany

- Bez souhlasu v nativním dialogu aplikace nic nefunguje, souhlas je po aplikacích a platí 30 minut.
- Zakázané: terminály, systémová nastavení, správci hesel, bankovnictví, Stavebák a Claude. Prohlížeče jen ke čtení.
- Snímek jen z okna povolené aplikace. Vstup jen do okna, které je ověřeně v popředí.
- Pohyb myší uživatele nebo Ctrl+Alt+Esc ovládání zastaví a zruší povolení.
- V CAD se odmítají příkazy spouštějící programy (`SHELL`, `STARTAPP`, `vlax-`). Je to pojistka, ne hranice.
- Klávesa Windows je zakázaná. Záznam akcí v `~/.stavebak/computer-use.log`, psaný text se nezapisuje.

## Klienti

- **Stavebak Desktop:** spustí server sám s první session.
- **Claude Code:** dnes ne, server je součástí aplikace. Až bude vydaný samostatně, přidá se jako lokální MCP.
- **Claude Desktop:** vestavěné ovládání počítače.
- Server stavebak.cz se nemění.

## Testy

- Pravidla a HTTP s falešnou plochou: `cargo test --lib computer_use`.
- Skutečný Claude Code proti falešné ploše, přesnost klikání: `cargo test --lib claude_clicks -- --ignored --nocapture`.
- Skutečná plocha Windows (přihlášená session v AWS): `scripts/windows-smoke/run.sh`, postup v README tamtéž.

## Ověřeno na Windows Server 2022 (2026-11-09)

Přihlášená plocha v AWS, celá aplikace v debug verzi: skutečný dialog souhlasu (Povolit, Nepovolit), snímek okna, psaní s diakritikou, Ctrl+S s kontrolou uloženého souboru, přesnost kliku při škálování 100 % a 150 %, přepnutí z cizího okna, zastavení pohybem myši a Ctrl+Alt+Esc, zákaz terminálu, záznam akcí bez psaného textu. V LibreCADu klik do příkazové řádky a nakreslení čáry příkazem, s kontrolou ve výkresu. Malování s kontrolou uloženého obrázku, LibreOffice Writer (česky psaný text v uloženém dokumentu) a Calc (hodnoty a vzorec v uloženém sešitu).

Nalezeno testem a opraveno: přenos okna do popředí, registrace zkratky na hlavním vlákně, přeházené znaky při rychlém psaní, klik mimo viditelnou část okna.

## Co chybí před vydáním

1. BricsCAD V23 Lite: potřebuje účet Bricsys. LibreCAD ho nenahrazuje. Word a Excel na testovacím stroji nejsou, potřebují licenci.
2. Skutečný model na skutečné ploše Windows: na testovacím stroji není přihlášený Claude. Falešná plocha a skutečný model zatím odděleně.
3. Strom ovládacích prvků (UI Automation), aby model klikal na prvky místo souřadnic.
4. Potvrzení souladu s podmínkami poskytovatele před vydáním projektantům.
5. macOS: povolení Zpřístupnění a Nahrávání obrazovky, aplikace o ně zatím nežádá, a kontrola viditelnosti bodu zatím jen na Windows.
6. Měření úspěšnosti na reálných úkonech.
7. Název aplikace může být celá cesta k programu (LibreCAD), pokud program nemá popis.
8. Nástroj pro tažení myší zatím není, kreslit nebo vybírat tažením model neumí.

## Podmínky Anthropicu

Binárka zůstává neupravená, tokenů se nedotýkáme, uživatel se přihlašuje sám a platí Claude sám. Interní přepínače binárky se nepoužívají. Dokumentace API žádá poučit uživatele o rizicích a získat souhlas, to dělá dialog.
