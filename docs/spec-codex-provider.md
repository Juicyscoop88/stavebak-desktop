# Druhý poskytovatel AI: ChatGPT přes Codex (issue #7)

Stav: návrh, 2026-10-26. Podmínky a rešerše: `docs/ops/openai-codex.md` v repu serveru (větev `test/58-openai-codex`).

## Cíl

Projektant si v desktopu vybere, s kým pracuje: **Claude** (předplatné Claude, dnešní stav) nebo **ChatGPT** (předplatné ChatGPT Plus/Pro přes Codex). Oba volají stejný MCP server Stavebáku. Desktop je zdarma a open source, placené jsou jen nástroje Stavebáku.

## Soulad s podmínkami (závazné)

| Pravidlo | Jak ho dodržíme |
|---|---|
| Přihlášení přes Codex (`codex login`, `account/login/*`) je pro komerční aplikace zakázané | Nepoužíváme. Codex dostane token jen z Sign in with ChatGPT (SIWC). Vlastní `CODEX_HOME` (`~/.stavebak/codex`), takže uživatelův `~/.codex` (včetně `auth.json`) se nikdy nenačte. Čtení `~/.codex/auth.json` dál blokuje `path_access.rs`. |
| SIWC Terms §1: vlastní jméno, nevydávat se za jinou aplikaci | `agent_name_hint` = `clientInfo.name` = `Stavebak Desktop`. Vlastní registrace klienta (`dynamic_agent_client` → vydané `oaiapp_…`), nikdy klient Codex CLI. |
| §1: tokeny jen lokálně pod kontrolou uživatele | Klíčenka OS (služba `cz.stavebak.desktop`, jako OAuth Stavebáku). Nikdy na náš server, do logů, telemetrie ani hlášení chyb. |
| §2 Connected application only | Token jde jen do procesu `codex app-server`, který spouští desktop. Žádné proxy ani API pro jiné nástroje. |
| §2 souhlas s během na pozadí | Na plánu ChatGPT nic nespouštíme bez akce uživatele. Generování názvu konverzace (dnes `claude -p --model haiku`) u Codexu vypnuto, název z první zprávy. |
| §2 No charge | Chat funguje bez účtu Stavebák (větev `fix/chat-bez-uctu`). |
| §3 privacy notice | Před prvním přihlášením přes ChatGPT krátká informace, co ukládáme (tokeny v klíčence, nic na náš server) s odkazem na zásady. |
| Licence DevKitu je nekomerční | Kód DevKitu nepoužíváme. OAuth je vlastní (vzor `stavebak_auth.rs`). |
| Binárka neupravená | Připnutá verze z GitHub release OpenAI, ověřený SHA-256. Chování jen přes oficiální `-c` konfiguraci. |
| Brand | Tlačítko „Continue with ChatGPT“ (v češtině „Pokračovat přes ChatGPT“ jen pokud to pokyny dovolí, jinak anglicky), žádné logo OpenAI výrazněji než naše, žádné „GPT“ v názvu. |

## Architektura

```
React UI ──(stejné události jako dnes)── Rust
                                         ├─ claude: `claude` stream-json (beze změny)
                                         └─ codex:  `codex-app-server --listen stdio://`
                                                     JSON-RPC → překlad na události ve tvaru stream-json
```

Parser chatu (`useStreamProcessor.ts`) zůstává. Rust adaptér `codex_session.rs` překládá události Codexu do tvaru, který parser zná:

| Codex | Událost pro UI |
|---|---|
| `thread/started` | `system/init` (`session_id` = `threadId`, `model`) |
| `item/agentMessage/delta` | `stream_event` `content_block_delta` `text_delta` |
| `item/reasoning/summaryTextDelta` | `stream_event` `thinking_delta` |
| `item/completed` `agentMessage` | `assistant` s blokem `text` |
| `item/started` `mcpToolCall` / `commandExecution` / `fileChange` / `webSearch` | `assistant` s blokem `tool_use` (`mcp__<server>__<tool>`, `Bash`, `Edit`/`Write`, `WebSearch`) |
| `item/completed` téhož | `user` s blokem `tool_result` (`is_error` podle `status`) |
| `turn/plan/updated` | `assistant` `tool_use` `TodoWrite` (karta úkolů) |
| `thread/tokenUsage/updated` | `stream_event` `message_start`/`message_delta` usage |
| `turn/completed` | `result` (`success` / `error`, `user_abort` při `interrupted`) |
| `error` (`willRetry=false`) | `system/error` |
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | `stavebak_permission_request` (`Bash` / `Edit`), odpověď `accept`/`acceptForSession`/`decline` |
| `mcpServer/elicitation/request` | zatím `decline` s poznámkou do chatu |
| konec procesu | `process_exit` |

Ovládání: další zpráva = `turn/start` na stejném vlákně, Stop = `turn/interrupt` (proces běží dál), změna modelu = `model`/`effort` v příštím `turn/start` (bez respawnu). Resume = `thread/resume` s `excludeTurns`.

Historie konverzací: Codex ukládá vlákna do `$CODEX_HOME/sessions/…/rollout-*.jsonl`. Seznam konverzací v desktopu dostane druhý zdroj (`thread/list` přes app-server, nebo čtení rollout souborů); konverzace nese poskytovatele a otevře se jen u něj.

## Spuštění Codexu

```
CODEX_HOME=~/.stavebak/codex
ACCESS_TOKEN=<SIWC access token>        # jen v prostředí potomka
STAVEBAK_TOKEN=<OAuth token Stavebáku>  # jen pokud je uživatel přihlášený
codex-app-server --listen stdio:// \
  -c model_provider="openai_chatgpt_plan" \
  -c model_providers.openai_chatgpt_plan.name="ChatGPT plan" \
  -c model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1" \
  -c model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN" \
  -c model_providers.openai_chatgpt_plan.wire_api="responses" \
  -c model_providers.openai_chatgpt_plan.requires_openai_auth=false \
  -c model_providers.openai_chatgpt_plan.supports_websockets=false \
  -c mcp_servers.stavebak.url="<cíl jako u Claude: localhost:3535 / stavebak.cz>" \
  -c mcp_servers.stavebak.bearer_token_env_var="STAVEBAK_TOKEN" \
  -c 'shell_environment_policy.exclude=["ACCESS_TOKEN","STAVEBAK_TOKEN"]' \
  -c shell_environment_policy.ignore_default_excludes=false \
  -c model_catalog_json="<katalog se supports_search_tool=false>"   # viz rizika
```

S API klíčem místo SIWC: stejný provider s `env_key="OPENAI_API_KEY"` a klíčem z klíčenky (klíč zadá uživatel v aplikaci).

## Přihlášení přes ChatGPT (Rust `openai_auth.rs`)

1. Při prvním použití vygenerovat `ext_agent_host_id` (`urn:uuid:…`) a uložit.
2. Prohlížeč: `https://auth.openai.com/api/accounts/authorize` s `client_id` (`dynamic_agent_client` poprvé, pak vydané `oaiapp_…`), `agent_name_hint=Stavebak Desktop` (jen poprvé), `ext_agent_host_id`, `response_type=code`, `redirect_uri=http://127.0.0.1:<port>/auth/callback`, `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, `state`, `nonce`, PKCE S256.
3. Callback: ověřit `state`, při `error=access_denied` konec. Uložit vydané `client_id`.
4. Výměna kódu na `https://auth.openai.com/api/accounts/oauth/token`. Ověřit ID token (JWKS, issuer, audience, exp, nonce) a že grant obsahuje `chatgpt.tokens.use.direct`.
5. Tokeny do klíčenky. Access token 1 h: obnova sériově (rotace refresh tokenu), pak restart app-serveru s novým `ACCESS_TOKEN` a `thread/resume`.
6. Odhlášení: revokace refresh tokenu (`revocation_endpoint` z OpenID konfigurace), smazání z klíčenky.

**Do vyjádření OpenAI**: zapnuto v debug buildu. V release buildu za přepínačem `siwc_enabled` (výchozí vypnuto, dokud uživatel nerozhodne o vydání).

## UX (pokyny OpenAI)

- Onboarding krok 1: „S kým chcete pracovat?“ Claude / ChatGPT. Po volbě ChatGPT tlačítko „Continue with ChatGPT“ a méně výrazně „Použít API klíč OpenAI“.
- Po prvním přihlášení jednou okno „You're using your ChatGPT plan“ / „Got it“.
- U výběru modelu štítek „Using ChatGPT plan“ s odkazem „Manage usage“ (https://chatgpt.com/settings/usage). Při `usageLimitExceeded` hláška s „Manage usage“ jako hlavní akcí.
- Nastavení → Účty: Claude, ChatGPT, Stavebák zvlášť. Plán ChatGPT oddělený od tarifu Stavebáku.
- Nová konverzace na výchozím poskytovateli (Nastavení), rozběhnutá zůstává u svého. Projekt je na MCP serveru, přepnutí o nic nepřijde.
- Ceník (web): u tarifů uvést „Funguje s předplatným Claude i ChatGPT“.

## Instalace binárky

Jako u Claude: stažení na pozadí do `~/.stavebak/bin/`. Zdroj: GitHub release `rust-v0.164.0`, asset `codex-app-server-<triple>` (macOS arm64/x64 `.tar.gz`, Windows x64 `.exe.zip`), SHA-256 natvrdo v kódu. Aktualizace verze = změna konstanty a kontrolních součtů v PR.

## Rizika k ověření testem

1. **`tool_search`**: Codex u všech modelů v katalogu (`supports_search_tool=true`) posílá s MCP nástroji Responses `tool_search`, které SIWC odmítá. Řešení: `model_catalog_json` s kopií katalogu s `supports_search_tool=false`. Ověřit, že to stačí a že model MCP nástroje vidí.
2. **Únik tokenů do příkazů modelu**: výchozí `shell_environment_policy` předává celé prostředí. Ověřit, že `exclude` funguje (příkaz `env` v sandboxu nesmí ukázat `ACCESS_TOKEN`).
3. **app-server je experimentální**: připnutá verze, aktualizace s testem.
4. **Free plán**: plán v open-source aplikacích má fungovat i pro Free, ověřit (`subscription_sharing_user_not_eligible`).
5. **Windows sandbox**: `mxc` vyžaduje Windows 11 24H2+, jinak `unelevated`.

## Pořadí implementace

1. Rust: instalace a nalezení `codex-app-server`, `codex_session.rs` (JSON-RPC, překlad událostí, schvalování, stop) s API klíčem. Testy překladu nad zachycenými událostmi.
2. Rust: `openai_auth.rs` (SIWC) + příkazy `openai_login`/`openai_logout`/`openai_auth_status`.
3. TS: poskytovatel v nastavení a u konverzace, `startSession` podle poskytovatele, onboarding s volbou, štítek plánu, Účty.
4. Seznam a obnova konverzací Codexu.
5. Test proti lokálnímu MCP (`localhost:3535`) s API klíčem, pak se SIWC (přihlášení uživatele, human in the loop).
