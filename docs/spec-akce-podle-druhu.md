# Spec: akce podle druhu (vedení za ručičku, fáze 1)

Stav: fáze 1 hotová (2026-10-21): formulář pro `ask-client` a `design`, jeden zvýrazněný další krok. Navazuje na [ADR-0002](adr/0002-mcp-driven-ui-architecture.md), vrstva 2 (panely pluginu).

## Problém

`guide` vrací typované akce (`nextActions`: druh, krok, chybějící parametry, případně tool). Desktop z nich ukázal jen „Pokračovat“, které poslalo Claudovi text. Výsledek: dlouhé odpovědi v chatu místo konkrétního kroku. Projektant není veden, čte.

## Řešení

Kliknutí na akci otevře ovládání podle druhu akce. Všechna data a zápisy jdou přes stejné MCP tooly a resources, jaké používá model. Desktop nemá doménovou logiku, jen vykresluje data ze serveru.

| Druh (`kind`) | Fáze 1 | Data ze serveru | Zápis |
|---|---|---|---|
| `ask-client` (Údaje od investora) | formulář chybějících údajů + nahrát zadání + „Připravit dotazník“ (Claude) | `nextActions[].parameters`, `stavebak://parameters` | `set_parameters` (channel `user`) |
| `design` (Údaje z návrhu) | formulář chybějících údajů | totéž | `set_parameters` (channel `user`) |
| ostatní (`public-data`, `confirm`, `order-supplier`, `request-authority`) | zatím „Pokračovat“ s Claudem | | |

Další krok je jeden a zvýrazněný, ostatní akce jsou pod ním tišeji.

Formulář: pole podle typu parametru (`number` s jednotkou, `enum` jako volba s českými popisky `valueLabels`, `boolean` Ano/Ne, `text`, `date`). Typy `list` a `geometry` formulář nevyplňuje, odkáže na Clauda. Prázdné pole se neukládá. Konflikty (silnější zdroj) server vrátí a formulář je ukáže, nic nepřepíše.

## Server (stavebak.cz)

- `stavebak://parameters` vydává i `valueLabels` a `plausible` (dnes chybí, formulář by ukazoval ID hodnot). Prospěje i modelu.

## Desktop

- Obecné `mcp_read_resource` (MCP `resources/read`) vedle `mcp_call_tool`. Žádný vlastní endpoint.
- Zápis: `set_parameters` s `parameters` ze `stavebak.json`, výsledek se uloží do `stavebak.json`, pak znovu `guide`.

## Jak to dělají tři klienti

- **Stavebak Desktop:** formulář z `stavebak://parameters`, zápis přes `set_parameters`, stejně jako model.
- **Claude Code:** beze změny, model vede textem podle `nextActions` a zapisuje `set_parameters`.
- **Claude Desktop:** beze změny (text). Interaktivní formulář by šel přes MCP Apps (vrstva 1 ADR-0002), to je fáze 3 a v `server/capabilities.ts` zatím není.

## Mimo fázi 1

- `public-data` jedním kliknutím: server musí u akce vrátit hotové volání (tool + argumenty z údajů projektu), aby desktop nic nedomýšlel.
- `confirm` (Ano/Ne): server musí říct, kam odpověď zapsat.
- Karty výsledků toolů v chatu (fáze 2), MCP Apps (fáze 3).
