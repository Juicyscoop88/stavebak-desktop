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

## Platformy

Zatím jen Windows. Na macOS se server nespustí a zkratka se neregistruje: aplikace tam nežádá o povolení Zpřístupnění a Nahrávání obrazovky a chybí kontrola viditelnosti bodu. Aktualizace jsou povinné pro všechny, proto je funkce na macOS vypnutá, ne napůl hotová.

## Ochrany

- Bez souhlasu v nativním dialogu aplikace nic nefunguje, souhlas je po aplikacích a platí 30 minut.
- Výchozí tlačítko dialogu je Nepovolit: Enter nebo mezerník psaný do jiného okna ve chvíli, kdy dialog vyskočí, nic nepovolí. Esc a křížek zamítnou.
- Dokud je dialog otevřený, jádro odmítne všechen vstup i další žádost, model si tak dialog nemůže potvrdit sám.
- Zakázané: terminály, systémová nastavení, správci hesel, bankovnictví, Stavebák a Claude. Prohlížeče jen ke čtení.
- Snímek jen z okna povolené aplikace. Vstup jen do okna, které je ověřeně v popředí.
- Pohyb myší uživatele nebo Ctrl+Alt+Esc ovládání zastaví a zruší povolení.
- V CAD se odmítají příkazy spouštějící programy (`SHELL`, `STARTAPP`, `vlax-`). Je to pojistka, ne hranice.
- Klávesa Windows je zakázaná. Záznam akcí v `~/.stavebak/computer-use.log`, psaný text se nezapisuje. Při převzetí řízení se zapíše, odkud kam se ukazatel posunul.

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

## Ověřeno na Windows 10 (2026-11-11)

Fyzický počítač se dvěma monitory (2560×1440 a 1920×1080 na záporných souřadnicích), rozložení CZ a US. Dvě čistá kola bez zásahu uživatele: Poznámkový blok (klik na druhém monitoru, diakritika, Ctrl+S, přepnutí z cizího okna, zastavení pohybem myši), Writer a Calc s kontrolou uloženého souboru. Dřívější pády (poškozený text ve Writeru, převzetí řízení po otevření cizího okna) způsobil skutečný vstup uživatele během testu.

Celá aplikace v debug verzi se skutečným modelem v chatu: model si vyžádal přístup, po Povolit napsal a uložil text s diakritikou a ověřil ho snímkem. Enter do dialogu přístup zamítl a model skončil bez zásahu do souboru.

Nalezeno a opraveno: výchozí tlačítko dialogu bylo Povolit, vstup nebyl během otevřeného dialogu blokovaný.

## Co chybí před vydáním

1. Potvrzení souladu s podmínkami poskytovatele před vydáním projektantům.

## Další kroky (vydání neblokují)

1. BricsCAD: potřebuje účet Bricsys, LibreCAD ho nenahrazuje. Word a Excel nevyzkoušené.
2. macOS: povolení Zpřístupnění a Nahrávání obrazovky, kontrola viditelnosti bodu, pak funkci zapnout.
3. Strom ovládacích prvků (UI Automation), aby model klikal na prvky místo souřadnic.
4. Měření úspěšnosti na reálných úkonech.
5. Název aplikace může být celá cesta k programu (LibreCAD), pokud program nemá popis.
6. Nástroj pro tažení myší zatím není, kreslit nebo vybírat tažením model neumí.
7. Seznam aplikací posílá modelu titulky všech dostupných oken (např. počet nepřečtených e-mailů). Zvážit, jestli titulky ukazovat jen u povolených aplikací.
8. Povolení platí pro aplikaci 30 minut napříč konverzacemi, ne jen v té, která o něj požádala.
9. Malování na vývojovém počítači neotevře .bmp ani ručně, test Malování tam neběží (s ovládáním nesouvisí).

## Podmínky Anthropicu

Binárka zůstává neupravená, tokenů se nedotýkáme, uživatel se přihlašuje sám a platí Claude sám. Interní přepínače binárky se nepoužívají. Dokumentace API žádá poučit uživatele o rizicích a získat souhlas, to dělá dialog.
