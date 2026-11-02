# ADR-0003: Most MCP s obnovou přihlášení

**Stav:** Přijato
**Datum:** 2026-11-02

## Problém

Session modelu (Claude Code, Codex) dostávala přístupový token Stavebáku při startu: Claude Code v hlavičce `Authorization` v `--mcp-config`, Codex v proměnné prostředí. Token platí hodinu, proces modelu běží hodiny i dny. Po hodině server každé volání nástroje odmítl a model radil „připojte se přes `/mcp`“, což v aplikaci nejde. Uživatel vidí, že se Stavebák „odpojuje“.

Druhá příčina: refresh token rotuje (starý po použití přestane platit). Dvě souběžné obnovy (panel a start session) skončily `invalid_grant` a aplikace uživatele odhlásila. Odhlašovala i při výpadku sítě.

## Rozhodnutí

Aplikace spouští **most na loopbacku** (`src-tauri/src/mcp_bridge.rs`). Session modelu míří na `http://127.0.0.1:<port>/mcp` a posílá jen tajný klíč mostu (`x-stavebak-bridge-key`). Most ke každému požadavku přidá platný token ze `stavebak_auth`:

- token před vypršením obnoví, po 401 ho obnoví a požadavek jednou zopakuje,
- obnovuje vždy jen jeden požadavek najednou (`REFRESH_LOCK`), ostatní převezmou nový token,
- odhlásí jen tehdy, když server refresh token odmítne (`invalid_grant`, `invalid_client`), výpadek sítě přihlášení nemaže,
- bez přihlášení vrátí chybu JSON-RPC se stavem 200 a návodem „přihlaste se v aplikaci“. HTTP 401 klientovi nepředává: Claude Code by spustil vlastní OAuth, které v aplikaci nejde dokončit, a server by do konce session považoval za nepřipojený,
- UI dostane událost `stavebak-auth-required` a lišta účtu nabídne přihlášení. Po přihlášení funguje další volání bez restartu konverzace.

Odpovědi proudí bez bufferu (SSE i JSON). Panely UI (`mcp_rpc`) mají stejnou obnovu po 401.

### Ochrana mostu

Jen `127.0.0.1`, náhodný port, klíč 32 bajtů z generátoru OS, porovnání v konstantním čase. `Host` musí být loopback s portem mostu a požadavek s `Origin` se odmítne (prohlížeč, DNS rebinding). Serveru se předávají jen hlavičky protokolu MCP, klíč mostu ne. Potomci dostanou `127.0.0.1,localhost` do `NO_PROXY`, aby most nešel přes proxy uživatele.

Token se tím nedostane do souborů, argumentů ani prostředí procesů modelu, ty znají jen klíč mostu platný po dobu běhu aplikace.

## Zvážené možnosti

| Možnost | Proč ne |
|---|---|
| Delší platnost přístupového tokenu na serveru | Jen oddálí problém (víkend, týden) a zhorší bezpečnost všech klientů. |
| `headersHelper` v Claude Code (příkaz vrací hlavičky, po 401 se spustí znovu) | Oficiální a funguje, ale jen pro Claude Code. Codex nic podobného nemá. Helper běží jako samostatný proces, takže by souběžné obnovy rotujícího refresh tokenu potřebovaly zámek napříč procesy. Token by šel do procesu modelu. |
| Codex: `config/value/write` + `config/mcpServer/reload` před každým tahem | Neřeší vypršení uprostřed tahu ani 401, token by ležel v `config.toml`. |
| Nechat OAuth na Claude Code a Codexu | Každý by měl vlastní přihlášení (uživatel se přihlašuje víckrát) a v neinteraktivní session ho nejde dokončit. |

Most řeší oba klienty stejně a obnovu drží v jednom procesu.

## Záloha

Když most nejde spustit (nemá nastat), session jde přímo na server s tokenem platným při startu, tedy jako dřív (`McpAccess::Direct`).

## Ověření

- `cargo test`: testy mostu s falešným serverem (předání tokenu, proud SSE, obnova a opakování po 401, odhlášení jako chyba JSON-RPC, výpadek, odmítnutí bez klíče a z prohlížeče).
- `cargo test --lib -- --ignored bridge_e2e --nocapture`: skutečný Claude Code přes most proti lokálnímu serveru (odvolaný token, vypršelý token, odhlášení, nové přihlášení bez restartu).
