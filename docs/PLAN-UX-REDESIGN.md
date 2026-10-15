# Plán: UX redesign Stavebák desktop

Stav k 2026-10-15. macOS first, Windows doladíme později. Sdílení v týmu a export DSP/DPS zatím neřešíme.

**Neměnit:** layout (vlevo soubory složky projektu, uprostřed chat, vpravo náhled po kliknutí na soubor) a branding (Switzer, logo, barvy). Vše jen polishujeme. Žádné dekorativní animace.

## Stav (2026-10-15, větev `redesign/ux`)

- [x] Fáze 0: snímky a nálezy
- [x] Nález č. 1: Stavebák MCP se předává do CLI (ověřeno voláním `fetch_cgs_data`)
- [x] Fáze 1: oficiální přihlášení natvrdo, žádné přechody, mrtvý kód, `tsc` čistý. Vnitřní provider logika (`providerStore`, `api-provider.ts`, spawn hash) zůstává k odstranění později.
- [x] Fáze 2 (základ): typografická škála, Switzer, root 16 px, plochá bublina, nadpisy, řádky stromu
- [x] Fáze 3: nastavení na jedné stránce
- [ ] Fáze 4–8

---

## Fáze 0 · Výchozí snímky

Uživatel spustí `pnpm tauri dev`, Claude okno vyfotí (`screencapture -l <windowId>`) do `docs/snapshots/before/`:
hlavní okno s chatem, náhled souboru (md, pdf, obrázek), nastavení (všechny taby), přepínač projektu, prázdný stav bez projektu, onboarding (přes reset `setupCompleted`).

Výstup: seznam konkrétních vizuálních nedostatků (zarovnání, výšky, velikosti písma), který se odškrtává ve fázi 2.

### Nálezy (2026-10-15, snímky v `docs/snapshots/before/`, jen lokálně)

Jak fotit: `pnpm tauri dev` na pozadí, pak `node scripts/stavebak-cli.mjs …` (harness v `src-tauri/src/test_harness.rs`, jen debug build).

**Kritické**
1. **Stavebák MCP se do CLI vůbec nepředává.** Spouští se `--strict-mcp-config` bez `--mcp-config` (`lib.rs`, OPT-7), takže Claude nemá žádné MCP nástroje. Test: dotaz „jaké podklady chybí k DSP“ vyřešil jen přes Bash/Read z obecných znalostí. Oprava: předávat aspoň server `stavebak` (nástroje CLI stejně načítá líně přes tool search).
2. Výchozí režim je `--permission-mode bypassPermissions` a model `claude-sonnet-4-6`. Seznam modelů v nastavení je zastaralý.
3. Do složky uživatele se automaticky zakládá `CLAUDE.md`. Stavař vidí cizí soubor.

**Jazyk a srozumitelnost**
4. Placeholder „Napište zprávu Claude Code…“.
5. Tool cally: „Terminál `ls /private/tmp/…`“, „Spouštím nástroj: Bash (10s · ↓ 221)“.
6. Onboarding „Vše připraveno“: „Claude CLI v2.1.299“, „Autentizováno“.
7. Červená tečka na ozubeném kolečku trvale svítí kvůli aktualizaci CLI. Pro stavaře to vypadá jako chyba. CLI aktualizovat tiše.
8. Přepínač projektu ukazuje v „Nedávné“ všechny složky z historie Claude Code (vibeclip, stavebak.cz…), ne jen projekty Stavebáku. Status hlásí `sessionCount: 523`, načítá se celá historie CC.

**Vizuál**
9. DXF se v náhledu ukazuje jako surový text (→ fáze 7).
10. PDF: tmavý plovoucí toolbar s velkými ikonami překrývá stránku a navíc je dole patička „Otevřít v systémovém prohlížeči“.
11. Markdown náhled: H1 je obří a těžký, nesedí k jemnému zbytku UI. Náhled má šedé pozadí, chat bílé.
12. Bublina uživatele: sytý tmavě zelený gradient, nejtěžší prvek obrazovky.
13. Řádky stromu jsou vysoké (~44 px na retina 2×), na delší projekty prostorově náročné.
14. Prázdný stav: „Nový projekt“ je šedý a vypadá jako neaktivní.
15. Hlavička chatu je prázdná, jen ikona ☰ (v režimu náhledu) nebo zelená tečka při běhu. Není jasné, co znamenají.

**Bugy**
16. Zvýraznění souboru ve stromu zůstává i po zavření náhledu (`revealTarget` se nemaže).
17. Druhý `FileExplorer` je vykreslený mimo okno (x > šířka okna), skrytý sekundární panel.
18. TypeScript: 7× nepoužitá proměnná (`tsc --noEmit` padá).

## Fáze 1 · Úklid (mrtvý kód z multi-provider éry)

- **Nejdřív nález č. 1: předat Stavebák MCP do CLI.** Bez toho appka nedělá to hlavní.

- Smazat provider systém: `components/settings/{Provider*,AddProviderMenu}.tsx`, `stores/providerStore.ts`, `lib/{api-provider,provider-presets,api-config}.ts`. Vyčistit reference v `App.tsx`, `chatStore`, `settingsStore`, `InputBar`, `ModelSelector`, `useStreamProcessor`, `sessionLifecycle`, `tauri-bridge`.
- Smazat UI `CliTab` (pin, repair, reinstall, Git Bash, Node) a `McpTab` (ruční editor). Rust příkazy, které onboarding potřebuje (detekce a instalace CLI), zůstávají.
- Zbytky TokenCode: `IS_ALPHA` / `TC/Alpha` v `Sidebar.tsx`, `lib/edition.ts`, čínské řetězce v `session-loader.ts`.
- Animace proti pravidlu „vše instantní“: `transition-all duration-300` v `BottomBar.tsx`, `animate-scale-in` v přepínači projektu, projít `transition-smooth`.
- i18n: projít klíče, které po úklidu nikdo nepoužívá (`i18n.ts` má 4 jazyky × ~680 klíčů).

Hotovo, když: `pnpm build` a `vitest` projdou, v UI nikde není „CLI“, „MCP“, „provider“.

## Fáze 2 · Design polish

- Tokeny v `App.css` `@theme`: spacing na mřížce 4 px, typografická škála 12 / 13 / 14 / 16 / 20, jasné role barev textu (primary / secondary / tertiary).
- Body font: Switzer jako první volba (dnes je až za `-apple-system`), tabulární číslice (`font-variant-numeric: tabular-nums`) pro čísla a výměry.
- Hlavičky panelů: 28 px spacer + 36 px řádek jednotně v sidebaru, chatu i náhledu (náhled už je rozpracovaný).
- Linky místo ploch: 1px `border-subtle`, minimum stínů a šedých podkladů.
- Chat: max šířka čtení ~720 px, rytmus mezer mezi zprávou, tool callem a odpovědí.
- Input bar: místo selectu „thinking level“ a módů jeden srozumitelný ovládací prvek (viz fáze 3, „Práce se soubory“).
- Porovnat se snímky z fáze 0, výstup do `docs/snapshots/after/`.

## Fáze 3 · Nastavení: jedna stránka

```
Účty          Claude: e-mail · plán · [Odhlásit]
              Stavebák: e-mail · Zdarma 3/5 · [Tarify]   (mock do OAuth)
Vzhled        Světlý / Tmavý / Podle systému
Jazyk         Čeština / Slovenčina / English / Deutsch
Práce se soubory
              [✓] Ptát se před úpravou souborů
Aktualizace   verze · [Co je nového] · [Zkontrolovat]
▸ Diagnostika verze Claude Code, stav Stavebák serveru, [Zkopírovat pro podporu]
```

Bez tabů a bez volby modelu. Model řeší app (výchozí nejlepší dostupný).

## Fáze 4 · Onboarding

1. **Vítejte.** „Potřebujete dvě věci“: ☐ předplatné Claude (placené) ☐ účet Stavebák (zdarma). Jedna věta: Claude je mozek, Stavebák zná vyhlášku.
2. **Claude.** „Máte Claude Pro nebo Max?“ → [Přihlásit] (prohlížeč, app sama polluje `checkClaudeAuth` každé ~2 s, žádné Retry) / [Založit předplatné] (claude.ai). API klíč pod „Pokročilé“.
3. **Stavebák.** OAuth (zatím mock obrazovka + deep link `stavebak://auth`), zpráva o free usage.
4. **Hotovo** → prázdný stav (fáze 5).

- Instalace CLI běží tiše na pozadí od kroku 1. Obrazovka se ukáže jen při chybě, lidskou řečí.
- Checklist z kroku 1 se odškrtává napříč kroky.
- Indikátor free usage dole v sidebaru vedle ozubeného kolečka. Nabídka placení až po momentu hodnoty (např. vygenerovaná zpráva B), nikdy při startu.
- Soubor: `components/setup/SetupWizard.tsx`, `stores/setupStore.ts`.

## Fáze 5 · Prázdný stav a checklist dokumentace

- **Bez projektu:** [Nový projekt] / [Otevřít složku] / „Vyzkoušet ukázkový projekt“ (přibalená složka RD se `stavebak.json`, podklady a vzorovým DXF).
- **Projekt se `stavebak.json`:** v prázdném chatu shrnutí „DSP · 4/11 · další krok: radon [Pokračovat]“.
- **Řádek „Dokumentace DSP 4/11“** připnutý nahoře ve `FileExplorer`. Klik otevře checklist v pravém náhledu (stejný mechanismus jako soubor). Je to renderer pro `stavebak.json`.
- „Pokračovat“ vloží do inputu připravený pokyn, neodesílá sám.
- Formát `stavebak.json` ověřit proti aktuálnímu (zatím nenasazenému) Stavebák MCP.

## Fáze 6 · Notifikace

- Přejít z web `Notification` (`useStreamProcessor.ts:2986`) na `tauri-plugin-notification` (nativní, spolehlivé v bundlu).
- Kdy: běh skončil, Claude čeká na schválení nebo otázku, chyba. Jen když okno není ve focusu.
- Obsah: konkrétně („Souhrnná technická zpráva je hotová“), ne „Chat dokončen“. Klik na notifikaci přepne do app.
- Badge na ikoně v Docku, dokud uživatel nepřepne do okna.
- Povolení si vyžádat až při prvním dlouhém běhu, ne při startu.

## Fáze 7 · CAD náhled (nový renderer ve `FilePreview`, interakce beze změny)

- **DXF:** `dxf-viewer` (MPL-2.0, WebGL, texty, šrafy, bloky, vrstvy). Lazy-load jen pro `.dxf`.
- **UX:** tmavé plátno (přepínatelné na světlé), „Zobrazit vše“, kolečko = zoom, tažení = posun, panel vrstev, [Otevřít v CADu].
- **DWG:** jen open-source cesta je LibreDWG (GPL-3.0). App je Apache-2.0, takže ji **nelinkovat do bundlu**. Varianta: samostatný sidecar proces (DWG → DXF) a pak stejný viewer. **Rozhodnutí na uživateli** po konzultaci licence.
- **IFC (3D):** ThatOpen / web-ifc, až později.

## Fáze 8 · Lidské popisky nástrojů

- `getToolLabel` v `MessageBubble.tsx` dnes pro MCP nástroje vrací surový název (`mcp__stavebak__fetch_cgs_data`).
- Doplnit mapu Stavebák nástrojů: „Načítám radon a geologii z ČGS“, „Ověřuji vytažená data“, „Generuji textovou část“, „Kreslím náhled výkresu“… (i18n, 4 jazyky).
- Obecné CC nástroje přejmenovat do řeči stavaře („Čtu soubor“, „Upravuji dokument“).

---

## Otevřené otázky

- DWG licence (fáze 7).
- Formát a nasazení nového Stavebák MCP (ovlivňuje fáze 5 a 8).
- Stavebák OAuth backend (fáze 4 je zatím jen UX).
