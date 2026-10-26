//! Codex jako druhý poskytovatel AI (docs/spec-codex-provider.md).
//!
//! Adaptér zvenku vypadá jako proces `claude` ve stream-json: přijímá stejné řádky
//! (zpráva uživatele, `control_response` na schválení, `control_request` interrupt /
//! set_model / set_permission_mode) a vydává události ve tvaru, který zná parser chatu
//! (`system/init`, `stream_event`, `assistant`, `user`, `result`, `stavebak_permission_request`).
//! Uvnitř mluví JSON-RPC s neupraveným `codex-app-server` přes stdio.
//!
//! Podmínky (SIWC Terms, docs/ops/openai-codex.md v repu serveru): přihlášení řízené
//! Codexem se nepoužívá, token dodá aplikace přes `ACCESS_TOKEN`, vlastní `CODEX_HOME`,
//! tokeny se nikdy nelogují a nedědí je příkazy, které spouští model.

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

/// Připnutá verze `codex-app-server` (GitHub release `rust-v<verze>` v openai/codex).
pub const CODEX_VERSION: &str = "0.164.0";
/// Jméno aplikace pro OpenAI: `clientInfo.name` i `agent_name_hint` při registraci SIWC (Terms §1).
pub const CLIENT_NAME: &str = "Stavebak Desktop";
pub const ACCESS_TOKEN_ENV: &str = "ACCESS_TOKEN";
pub const API_KEY_ENV: &str = "OPENAI_API_KEY";
pub const STAVEBAK_TOKEN_ENV: &str = "STAVEBAK_TOKEN";
/// Prefix `request_id` schválení, aby se odpověď z UI dala poznat a vrátit Codexu.
const APPROVAL_PREFIX: &str = "codex:";
const MANAGE_USAGE_URL: &str = "https://chatgpt.com/settings/usage";

/// Čím Codex platí: plán ChatGPT (token ze Sign in with ChatGPT) nebo API klíč uživatele.
#[derive(Clone)]
pub enum CodexAuth {
    ChatgptPlan(String),
    ApiKey(String),
}

impl std::fmt::Debug for CodexAuth {
    // Token nikdy do logu
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CodexAuth::ChatgptPlan(_) => f.write_str("ChatgptPlan(***)"),
            CodexAuth::ApiKey(_) => f.write_str("ApiKey(***)"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub auth: CodexAuth,
    pub codex_home: PathBuf,
    pub mcp_server: String,
    pub mcp_url: String,
    pub stavebak_token: Option<String>,
    /// Katalog modelů se `supports_search_tool=false` (Responses `tool_search` SIWC odmítá).
    pub model_catalog: Option<PathBuf>,
}

fn toml_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// Argumenty `codex-app-server`. Tokeny nikdy v argumentech (byly by vidět v seznamu procesů),
/// jen názvy proměnných prostředí.
pub fn launch_args(cfg: &LaunchConfig) -> Vec<String> {
    let (provider, provider_name, env_key) = match cfg.auth {
        CodexAuth::ChatgptPlan(_) => ("openai_chatgpt_plan", "ChatGPT plan", ACCESS_TOKEN_ENV),
        CodexAuth::ApiKey(_) => ("openai_api_key", "OpenAI API", API_KEY_ENV),
    };
    let p = format!("model_providers.{provider}");
    let mut overrides = vec![
        format!("model_provider={}", toml_str(provider)),
        format!("{p}.name={}", toml_str(provider_name)),
        format!("{p}.base_url={}", toml_str("https://api.openai.com/v1")),
        format!("{p}.env_key={}", toml_str(env_key)),
        format!("{p}.wire_api={}", toml_str("responses")),
        format!("{p}.requires_openai_auth=false"),
        format!("{p}.supports_websockets=false"),
        format!("mcp_servers.{}.url={}", cfg.mcp_server, toml_str(&cfg.mcp_url)),
        // Nástroje Stavebáku neschvalovat jeden po druhém: čtecí jsou bezpečné, zápisy
        // jdou jen do projektu uživatele na serveru (stejně jako u Claude).
        format!("mcp_servers.{}.default_tools_approval_mode=\"approve\"", cfg.mcp_server),
        // Tokeny z prostředí app-serveru nesmí zdědit příkazy, které spouští model
        // (výchozí shell_environment_policy předává celé prostředí).
        format!(
            "shell_environment_policy.exclude=[{},{},{}]",
            toml_str(ACCESS_TOKEN_ENV),
            toml_str(API_KEY_ENV),
            toml_str(STAVEBAK_TOKEN_ENV)
        ),
        "shell_environment_policy.ignore_default_excludes=false".to_string(),
    ];
    if cfg.stavebak_token.is_some() {
        overrides.push(format!(
            "mcp_servers.{}.bearer_token_env_var={}",
            cfg.mcp_server,
            toml_str(STAVEBAK_TOKEN_ENV)
        ));
    }
    if let Some(catalog) = &cfg.model_catalog {
        overrides.push(format!(
            "model_catalog_json={}",
            toml_str(&catalog.to_string_lossy())
        ));
    }
    let mut args = vec!["--listen".to_string(), "stdio://".to_string()];
    for o in overrides {
        args.push("-c".into());
        args.push(o);
    }
    args
}

/// Prostředí potomka: vlastní CODEX_HOME (nikdy ~/.codex uživatele) a tokeny.
pub fn launch_env(cfg: &LaunchConfig) -> Vec<(String, String)> {
    let mut env = vec![(
        "CODEX_HOME".to_string(),
        cfg.codex_home.to_string_lossy().to_string(),
    )];
    match &cfg.auth {
        CodexAuth::ChatgptPlan(t) => env.push((ACCESS_TOKEN_ENV.into(), t.clone())),
        CodexAuth::ApiKey(k) => env.push((API_KEY_ENV.into(), k.clone())),
    }
    if let Some(t) = &cfg.stavebak_token {
        env.push((STAVEBAK_TOKEN_ENV.into(), t.clone()));
    }
    env
}

/// Proměnné, které potomek z prostředí aplikace dědit nesmí (jeho vlastní dostane z launch_env).
pub const ENV_REMOVE: &[&str] = &[
    "CODEX_HOME",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ACCESS_TOKEN",
    "STAVEBAK_TOKEN",
];

/// Katalog modelů z `models.json` Codexu s vypnutým `supports_search_tool`.
/// Zapojí se, pokud test se SIWC potvrdí, že Responses `tool_search` selhává (spec, rizika 1).
#[allow(dead_code)]
pub fn catalog_without_tool_search(catalog: &Value) -> Value {
    let mut out = catalog.clone();
    fn walk(v: &mut Value) {
        match v {
            Value::Object(map) => {
                if map.contains_key("supports_search_tool") {
                    map.insert("supports_search_tool".into(), Value::Bool(false));
                }
                for (_, child) in map.iter_mut() {
                    walk(child);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(walk),
            _ => {}
        }
    }
    walk(&mut out);
    out
}

/// Režim oprávnění z UI (stejné hodnoty jako `--permission-mode` u Claude) → politika Codexu.
pub fn policy_for_mode(mode: &str) -> (&'static str, &'static str) {
    match mode {
        // Plán: jen čtení, model se zeptá, když potřebuje víc
        "plan" => ("on-request", "read-only"),
        // Zeptat se: schválit vše, co není důvěryhodné
        "default" => ("untrusted", "workspace-write"),
        // Bez dotazů, ale stále v sandboxu pracovní složky
        "bypassPermissions" => ("never", "workspace-write"),
        // Kód (acceptEdits): úpravy v pracovní složce bez dotazu, mimo ni se zeptá
        _ => ("on-request", "workspace-write"),
    }
}

fn sandbox_policy(sandbox: &str) -> Value {
    match sandbox {
        "read-only" => json!({ "type": "readOnly" }),
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        _ => json!({ "type": "workspaceWrite" }),
    }
}

/// Model z UI: u Codexu jen ID modelů OpenAI, aliasy Claude (sonnet, opus…) ignorovat.
pub fn codex_model(model: Option<&str>) -> Option<String> {
    let m = model?.trim();
    let lower = m.to_ascii_lowercase();
    if lower.starts_with("gpt-") || lower.starts_with("codex-") || lower.starts_with('o') && lower[1..].starts_with(|c: char| c.is_ascii_digit()) {
        Some(m.to_string())
    } else {
        None
    }
}

/// Úroveň přemýšlení z UI → `effort`. Mimo známé úrovně nechat výchozí modelu.
pub fn codex_effort(level: Option<&str>) -> Option<&'static str> {
    match level? {
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "max" => Some("xhigh"),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Call {
    Initialize,
    ThreadOpen,
    TurnStart,
    Steer,
    Other,
}

/// Co odeslat Codexu a co UI.
#[derive(Debug, Default)]
pub struct Out {
    pub to_codex: Vec<Value>,
    pub to_ui: Vec<Value>,
    /// Vlákno se nepodařilo otevřít: proces ukončit.
    pub fatal: bool,
}

/// Stav jedné konverzace: překládá mezi stream-json (UI) a JSON-RPC (Codex). Bez I/O.
pub struct Translator {
    cwd: String,
    resume_thread: Option<String>,
    thread_id: Option<String>,
    model: Option<String>,
    effort: Option<&'static str>,
    mode: String,
    mode_changed: bool,
    turn_id: Option<String>,
    turn_active: bool,
    next_id: i64,
    calls: HashMap<i64, Call>,
    queued: VecDeque<String>,
    items: HashMap<String, Value>,
    usage: Value,
    stavebak_server: String,
}

impl Translator {
    pub fn new(
        cwd: &str,
        resume_thread: Option<String>,
        model: Option<String>,
        effort: Option<&'static str>,
        mode: &str,
        stavebak_server: &str,
    ) -> Self {
        Self {
            cwd: cwd.to_string(),
            resume_thread,
            thread_id: None,
            model,
            effort,
            mode: mode.to_string(),
            mode_changed: false,
            turn_id: None,
            turn_active: false,
            next_id: 1,
            calls: HashMap::new(),
            queued: VecDeque::new(),
            items: HashMap::new(),
            usage: Value::Null,
            stavebak_server: stavebak_server.to_string(),
        }
    }

    pub fn thread_id(&self) -> Option<&str> {
        self.thread_id.as_deref()
    }

    fn request(&mut self, kind: Call, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.calls.insert(id, kind);
        json!({ "id": id, "method": method, "params": params })
    }

    fn with_session(&self, mut v: Value) -> Value {
        if let (Some(t), Some(obj)) = (&self.thread_id, v.as_object_mut()) {
            obj.insert("session_id".into(), Value::String(t.clone()));
        }
        v
    }

    /// Úvodní zpráva po spuštění procesu.
    pub fn start(&mut self) -> Out {
        let init = self.request(
            Call::Initialize,
            "initialize",
            json!({
                "clientInfo": { "name": CLIENT_NAME, "title": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION") },
                "capabilities": { "experimentalApi": false }
            }),
        );
        Out { to_codex: vec![init], ..Default::default() }
    }

    fn open_thread(&mut self) -> Value {
        let (approval, sandbox) = policy_for_mode(&self.mode);
        let mut params = json!({
            "cwd": self.cwd,
            "approvalPolicy": approval,
            "approvalsReviewer": "user",
            "sandbox": sandbox,
        });
        if let Some(m) = &self.model {
            params["model"] = json!(m);
        }
        match self.resume_thread.clone() {
            Some(id) => {
                params["threadId"] = json!(id);
                params["excludeTurns"] = json!(true);
                self.request(Call::ThreadOpen, "thread/resume", params)
            }
            None => self.request(Call::ThreadOpen, "thread/start", params),
        }
    }

    fn turn_start(&mut self, text: String) -> Value {
        let thread = self.thread_id.clone().unwrap_or_default();
        let mut params = json!({
            "threadId": thread,
            "input": [{ "type": "text", "text": text, "textElements": [] }],
        });
        if self.mode_changed {
            let (approval, sandbox) = policy_for_mode(&self.mode);
            params["approvalPolicy"] = json!(approval);
            params["sandboxPolicy"] = sandbox_policy(sandbox);
            self.mode_changed = false;
        }
        if let Some(m) = &self.model {
            params["model"] = json!(m);
        }
        if let Some(e) = self.effort {
            params["effort"] = json!(e);
        }
        self.turn_active = true;
        self.request(Call::TurnStart, "turn/start", params)
    }

    fn send_or_queue(&mut self, text: String, out: &mut Out) {
        if self.thread_id.is_none() {
            self.queued.push_back(text);
        } else if self.turn_active {
            match self.turn_id.clone() {
                // Zpráva během tahu: Codex ji umí přidat do běžícího tahu
                Some(turn) => {
                    let thread = self.thread_id.clone().unwrap_or_default();
                    let steer = self.request(
                        Call::Steer,
                        "turn/steer",
                        json!({
                            "threadId": thread,
                            "expectedTurnId": turn,
                            "input": [{ "type": "text", "text": text, "textElements": [] }],
                        }),
                    );
                    out.to_codex.push(steer);
                }
                None => self.queued.push_back(text),
            }
        } else {
            let req = self.turn_start(text);
            out.to_codex.push(req);
        }
    }

    fn flush_queue(&mut self, out: &mut Out) {
        if self.thread_id.is_some() && !self.turn_active {
            let texts: Vec<String> = self.queued.drain(..).collect();
            if !texts.is_empty() {
                let req = self.turn_start(texts.join("\n\n"));
                out.to_codex.push(req);
            }
        }
    }

    /// Řádek stream-json z UI (stejný, jaký by šel do `claude`).
    pub fn on_input(&mut self, line: &str) -> Out {
        let mut out = Out::default();
        let Ok(msg) = serde_json::from_str::<Value>(line) else { return out };
        match msg.get("type").and_then(|v| v.as_str()) {
            Some("user") => {
                let text = user_text(&msg["message"]["content"]);
                if !text.trim().is_empty() {
                    self.send_or_queue(text, &mut out);
                }
            }
            Some("control_response") => {
                let resp = &msg["response"];
                let rid = resp["request_id"].as_str().unwrap_or_default();
                if let Some(raw) = rid.strip_prefix(APPROVAL_PREFIX) {
                    let id: Value = serde_json::from_str(raw).unwrap_or(Value::String(raw.into()));
                    let allow = resp["response"]["behavior"].as_str() == Some("allow");
                    let decision = if allow { "accept" } else { "decline" };
                    out.to_codex.push(json!({ "id": id, "result": { "decision": decision } }));
                }
            }
            Some("control_request") => {
                let req = &msg["request"];
                match req["subtype"].as_str() {
                    Some("interrupt") => {
                        if let (true, Some(turn), Some(thread)) =
                            (self.turn_active, self.turn_id.clone(), self.thread_id.clone())
                        {
                            let r = self.request(
                                Call::Other,
                                "turn/interrupt",
                                json!({ "threadId": thread, "turnId": turn }),
                            );
                            out.to_codex.push(r);
                        }
                    }
                    Some("set_model") => {
                        self.model = codex_model(req["model"].as_str());
                    }
                    Some("set_permission_mode") => {
                        if let Some(mode) = req["mode"].as_str() {
                            self.mode = mode.to_string();
                            self.mode_changed = true;
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        out
    }

    /// Řádek JSON-RPC od Codexu.
    pub fn on_codex(&mut self, line: &str) -> Out {
        let mut out = Out::default();
        let Ok(msg) = serde_json::from_str::<Value>(line) else { return out };
        let method = msg.get("method").and_then(|v| v.as_str());
        let id = msg.get("id").cloned();
        match (method, id) {
            (None, Some(id)) => self.on_response(&id, &msg, &mut out),
            (Some(m), Some(id)) => self.on_server_request(m, id, &msg["params"], &mut out),
            (Some(m), None) => self.on_notification(m, &msg["params"], &mut out),
            _ => {}
        }
        out
    }

    fn on_response(&mut self, id: &Value, msg: &Value, out: &mut Out) {
        let Some(kind) = id.as_i64().and_then(|n| self.calls.remove(&n)) else { return };
        if let Some(err) = msg.get("error") {
            let text = err["message"].as_str().unwrap_or("Codex: neznámá chyba").to_string();
            match kind {
                Call::Initialize | Call::ThreadOpen => {
                    out.to_ui.push(system_error(&text));
                    out.fatal = true;
                }
                Call::TurnStart => {
                    self.turn_active = false;
                    out.to_ui.push(self.result(false, &text));
                }
                // Tah mezitím skončil: zprávu pošleme jako nový tah
                Call::Steer => {}
                Call::Other => {}
            }
            return;
        }
        let result = &msg["result"];
        match kind {
            Call::Initialize => {
                out.to_codex.push(json!({ "method": "initialized" }));
                let open = self.open_thread();
                out.to_codex.push(open);
            }
            Call::ThreadOpen => {
                self.thread_id = result["thread"]["id"].as_str().map(String::from);
                if let Some(m) = result["model"].as_str() {
                    self.model.get_or_insert_with(|| m.to_string());
                }
                let init = json!({
                    "type": "system",
                    "subtype": "init",
                    "model": result["model"].as_str().unwrap_or_default(),
                    "provider": "codex",
                    "cwd": self.cwd,
                });
                out.to_ui.push(self.with_session(init));
                self.flush_queue(out);
            }
            Call::TurnStart => {
                if let Some(t) = result["turn"]["id"].as_str() {
                    self.turn_id = Some(t.to_string());
                }
            }
            Call::Steer | Call::Other => {}
        }
    }

    fn on_server_request(&mut self, method: &str, id: Value, params: &Value, out: &mut Out) {
        let request_id = format!("{APPROVAL_PREFIX}{id}");
        let item_id = params["itemId"].as_str().unwrap_or_default().to_string();
        match method {
            "item/commandExecution/requestApproval" => {
                let command = params["command"].as_str().unwrap_or_default();
                out.to_ui.push(json!({
                    "type": "stavebak_permission_request",
                    "request_id": request_id,
                    "tool_name": "Bash",
                    "input": { "command": command, "description": params["reason"].as_str().unwrap_or_default() },
                    "tool_use_id": item_id,
                    "description": params["reason"],
                }));
            }
            "item/fileChange/requestApproval" => {
                let paths: Vec<String> = self
                    .items
                    .get(&item_id)
                    .and_then(|i| i["changes"].as_array())
                    .map(|c| c.iter().filter_map(|x| x["path"].as_str().map(String::from)).collect())
                    .unwrap_or_default();
                out.to_ui.push(json!({
                    "type": "stavebak_permission_request",
                    "request_id": request_id,
                    "tool_name": "Edit",
                    "input": { "file_path": paths.join(", ") },
                    "tool_use_id": item_id,
                    "description": params["reason"],
                }));
            }
            "mcpServer/elicitation/request" => {
                // Formuláře MCP serveru UI zatím neumí: odmítnout, model pokračuje
                out.to_codex.push(json!({ "id": id, "result": { "action": "decline", "content": null, "_meta": null } }));
            }
            _ => {
                out.to_codex.push(json!({
                    "id": id,
                    "error": { "code": -32601, "message": format!("{CLIENT_NAME}: {method} není podporováno") }
                }));
            }
        }
    }

    fn tool_use(&self, item: &Value) -> Option<Value> {
        let id = item["id"].as_str()?;
        let (name, input) = match item["type"].as_str()? {
            "mcpToolCall" => {
                let server = item["server"].as_str().unwrap_or_default();
                let tool = item["tool"].as_str().unwrap_or_default();
                let server = if server.is_empty() { &self.stavebak_server } else { server };
                (format!("mcp__{server}__{tool}"), item["arguments"].clone())
            }
            "commandExecution" => (
                "Bash".to_string(),
                json!({ "command": item["command"], "description": "" }),
            ),
            "fileChange" => {
                let changes = item["changes"].as_array().cloned().unwrap_or_default();
                let path = changes.first().and_then(|c| c["path"].as_str()).unwrap_or_default();
                let added = changes.len() == 1 && changes[0]["kind"]["type"].as_str() == Some("add");
                let name = if added { "Write" } else { "Edit" };
                let diff: Vec<&str> = changes.iter().filter_map(|c| c["diff"].as_str()).collect();
                (name.to_string(), json!({ "file_path": path, "diff": diff.join("\n") }))
            }
            "webSearch" => ("WebSearch".to_string(), json!({ "query": item["query"] })),
            _ => return None,
        };
        let input = if input.is_null() { json!({}) } else { input };
        Some(json!({ "type": "tool_use", "id": id, "name": name, "input": input }))
    }

    fn tool_result(item: &Value) -> Option<Value> {
        let id = item["id"].as_str()?;
        let status = item["status"].as_str().unwrap_or("completed");
        let is_error = matches!(status, "failed" | "declined");
        let content = match item["type"].as_str()? {
            "mcpToolCall" => {
                if let Some(e) = item["error"]["message"].as_str() {
                    e.to_string()
                } else {
                    item["result"]["content"]
                        .as_array()
                        .map(|c| {
                            c.iter()
                                .filter_map(|b| b["text"].as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default()
                }
            }
            "commandExecution" => item["aggregatedOutput"].as_str().unwrap_or_default().to_string(),
            "fileChange" => match status {
                "declined" => "Změna zamítnuta.".to_string(),
                "failed" => "Změnu se nepodařilo zapsat.".to_string(),
                _ => "Hotovo.".to_string(),
            },
            "webSearch" => String::new(),
            _ => return None,
        };
        Some(json!({ "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error }))
    }

    fn assistant(&self, block: Value) -> Value {
        self.with_session(json!({
            "type": "assistant",
            "message": { "role": "assistant", "content": [block] },
            "parent_tool_use_id": null,
        }))
    }

    fn result(&self, success: bool, error: &str) -> Value {
        let u = &self.usage["last"];
        let usage = json!({
            "input_tokens": u["inputTokens"].as_i64().unwrap_or(0),
            "output_tokens": u["outputTokens"].as_i64().unwrap_or(0),
            "cache_read_input_tokens": u["cachedInputTokens"].as_i64().unwrap_or(0),
        });
        let mut r = json!({
            "type": "result",
            "subtype": if success { "success" } else { "error_during_execution" },
            "is_error": !success,
            "usage": usage,
        });
        if !success {
            r["result"] = json!(error);
        }
        self.with_session(r)
    }

    fn on_notification(&mut self, method: &str, p: &Value, out: &mut Out) {
        match method {
            "item/agentMessage/delta" => {
                if let Some(d) = p["delta"].as_str() {
                    out.to_ui.push(self.with_session(json!({
                        "type": "stream_event",
                        "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": d } },
                    })));
                }
            }
            "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
                if let Some(d) = p["delta"].as_str() {
                    out.to_ui.push(self.with_session(json!({
                        "type": "stream_event",
                        "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "thinking_delta", "thinking": d } },
                    })));
                }
            }
            "item/started" => {
                let item = &p["item"];
                if let Some(id) = item["id"].as_str() {
                    self.items.insert(id.to_string(), item.clone());
                }
                if let Some(block) = self.tool_use(item) {
                    out.to_ui.push(self.assistant(block));
                }
            }
            "item/completed" => {
                let item = &p["item"];
                let item_id = item["id"].as_str().unwrap_or_default().to_string();
                match item["type"].as_str() {
                    Some("agentMessage") => {
                        let text = item["text"].as_str().unwrap_or_default();
                        if !text.is_empty() {
                            out.to_ui.push(self.assistant(json!({ "type": "text", "text": text })));
                        }
                    }
                    Some("reasoning") => {
                        let summary = item["summary"]
                            .as_array()
                            .map(|s| s.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("\n\n"))
                            .unwrap_or_default();
                        if !summary.is_empty() {
                            out.to_ui.push(self.assistant(json!({ "type": "thinking", "thinking": summary })));
                        }
                    }
                    _ => {
                        // Položka mohla přijít bez item/started (třeba po schválení): doplnit tool_use
                        if !self.items.contains_key(&item_id) {
                            if let Some(block) = self.tool_use(item) {
                                out.to_ui.push(self.assistant(block));
                            }
                        }
                        if let Some(block) = Self::tool_result(item) {
                            out.to_ui.push(self.with_session(json!({
                                "type": "user",
                                "message": { "role": "user", "content": [block] },
                                "parent_tool_use_id": null,
                            })));
                        }
                    }
                }
                self.items.remove(&item_id);
            }
            "turn/started" => {
                if let Some(t) = p["turn"]["id"].as_str() {
                    self.turn_id = Some(t.to_string());
                }
                self.turn_active = true;
            }
            "turn/plan/updated" => {
                let turn = p["turnId"].as_str().unwrap_or_default();
                let todos: Vec<Value> = p["plan"]
                    .as_array()
                    .map(|steps| {
                        steps
                            .iter()
                            .map(|s| {
                                let status = match s["status"].as_str() {
                                    Some("inProgress") => "in_progress",
                                    Some("completed") => "completed",
                                    _ => "pending",
                                };
                                json!({ "content": s["step"], "activeForm": s["step"], "status": status })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                out.to_ui.push(self.assistant(json!({
                    "type": "tool_use",
                    "id": format!("codex_plan_{turn}"),
                    "name": "TodoWrite",
                    "input": { "todos": todos },
                })));
            }
            "thread/tokenUsage/updated" => {
                self.usage = p["tokenUsage"].clone();
            }
            "turn/completed" => {
                let turn = &p["turn"];
                self.turn_active = false;
                self.turn_id = None;
                let status = turn["status"].as_str().unwrap_or_default();
                let r = match status {
                    "completed" => self.result(true, ""),
                    "interrupted" => {
                        let mut r = self.result(false, "user_abort");
                        r["subtype"] = json!("user_abort");
                        r
                    }
                    _ => {
                        let msg = error_text(&turn["error"]);
                        self.result(false, &msg)
                    }
                };
                out.to_ui.push(r);
                self.flush_queue(out);
            }
            "error" => {
                if !p["willRetry"].as_bool().unwrap_or(false) {
                    // Konec tahu nahlásí turn/completed s chybou, tady jen limit plánu,
                    // který potřebuje odkaz na správu využití (pokyny SIWC)
                    if p["error"]["codexErrorInfo"].as_str() == Some("usageLimitExceeded") {
                        out.to_ui.push(system_error(&format!(
                            "Limit plánu ChatGPT je vyčerpaný. Využití a limity: {MANAGE_USAGE_URL}"
                        )));
                    }
                }
            }
            "mcpServer/startupStatus/updated"
                if p["status"].as_str() == Some("failed")
                    && p["name"].as_str() == Some(&self.stavebak_server) =>
            {
                let why = p["error"].as_str().unwrap_or_default();
                out.to_ui.push(system_error(&format!(
                    "Nástroje Stavebáku se nepodařilo připojit. {why}"
                )));
            }
            _ => {}
        }
    }
}

fn system_error(text: &str) -> Value {
    json!({ "type": "system", "subtype": "error", "message": text })
}

fn error_text(err: &Value) -> String {
    let base = err["message"].as_str().unwrap_or("Odpověď se nepodařilo dokončit.").to_string();
    match err["codexErrorInfo"].as_str() {
        Some("usageLimitExceeded") => format!("Limit plánu ChatGPT je vyčerpaný. Využití a limity: {MANAGE_USAGE_URL}"),
        Some("unauthorized") => "Přihlášení k ChatGPT vypršelo nebo bylo odvoláno. Přihlaste se znovu v Nastavení.".to_string(),
        _ => base,
    }
}

/// Text zprávy uživatele ve tvaru stream-json (řetězec nebo bloky).
fn user_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Složka s rozbaleným balíčkem Codexu připnuté verze: `~/.stavebak/codex-runtime/<verze>/`
/// (`bin/codex-app-server`, pomocné `bin/codex-code-mode-host`, `codex-path/rg`, `codex-resources/`).
pub fn runtime_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".stavebak").join("codex-runtime").join(CODEX_VERSION))
}

/// Kde je binárka: `STAVEBAK_CODEX_BIN` (vývoj), jinak `bin/codex-app-server[.exe]` v runtime_dir.
pub fn find_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("STAVEBAK_CODEX_BIN") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    let name = if cfg!(windows) { "codex-app-server.exe" } else { "codex-app-server" };
    let p = runtime_dir()?.join("bin").join(name);
    p.is_file().then_some(p)
}

/// `~/.stavebak/codex`: odděleně od `~/.codex` uživatele (žádný jeho auth.json ani config).
pub fn codex_home() -> Option<PathBuf> {
    let p = dirs::home_dir()?.join(".stavebak").join("codex");
    std::fs::create_dir_all(&p).ok()?;
    Some(p)
}

/// Zapíše katalog bez tool_search vedle CODEX_HOME, pokud je k dispozici zdrojový katalog.
#[allow(dead_code)]
pub fn write_model_catalog(codex_home: &Path, source: &Value) -> Option<PathBuf> {
    let path = codex_home.join("models-no-tool-search.json");
    let data = serde_json::to_vec_pretty(&catalog_without_tool_search(source)).ok()?;
    std::fs::write(&path, data).ok()?;
    Some(path)
}

// ── Běh procesu ─────────────────────────────────────────────────────────────

use crate::commands::claude_process::{ManagedProcess, ProcessManager, SessionInfo, StdinManager};
use crate::events::emit_to_frontend;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct SessionStart {
    pub sid: String,
    pub cwd: String,
    pub prompt: String,
    pub resume_thread: Option<String>,
    pub model: Option<String>,
    pub effort: Option<&'static str>,
    pub mode: String,
}

async fn write_all(stdin: &mut Option<tokio::process::ChildStdin>, msgs: &[Value]) {
    let Some(pipe) = stdin.as_mut() else { return };
    for m in msgs {
        let line = format!("{}\n", m);
        if pipe.write_all(line.as_bytes()).await.is_err() || pipe.flush().await.is_err() {
            *stdin = None;
            return;
        }
    }
}

/// Spustí `codex-app-server` a zaregistruje ho stejně jako proces `claude`: vstup přes
/// StdinManager (kanál), Stop přes ProcessManager, události na `claude:stream:<sid>`.
pub async fn spawn_session(
    app: AppHandle,
    procs: ProcessManager,
    stdin_mgr: StdinManager,
    bin: PathBuf,
    launch: LaunchConfig,
    extra_env: Vec<(String, String)>,
    start: SessionStart,
) -> Result<SessionInfo, String> {
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args(launch_args(&launch))
        .current_dir(&start.cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    for k in ENV_REMOVE {
        cmd.env_remove(k);
    }
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    for (k, v) in launch_env(&launch) {
        cmd.env(k, v);
    }
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Codex se nepodařilo spustit ({}): {}", bin.display(), e))?;
    let pid = child.id().unwrap_or(0);
    eprintln!("[Stavebak] Codex spawned: pid={}, bin={}, auth={:?}", pid, bin.display(), launch.auth);

    let stdout = child.stdout.take().ok_or("Codex: chybí stdout")?;
    let stderr = child.stderr.take().ok_or("Codex: chybí stderr")?;
    let mut child_stdin = child.stdin.take();

    let sid = start.sid.clone();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    stdin_mgr.insert_channel(sid.clone(), tx.clone()).await;
    if !start.prompt.is_empty() {
        let first = json!({ "type": "user", "message": { "role": "user", "content": start.prompt } });
        let _ = tx.send(first.to_string());
    }
    drop(tx);

    let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
    let exit_notify = std::sync::Arc::new(tokio::sync::Notify::new());
    procs
        .insert(
            sid.clone(),
            ManagedProcess {
                session_id: sid.clone(),
                pid,
                kill_tx: Some(kill_tx),
                exit_notify: exit_notify.clone(),
            },
        )
        .await;

    {
        let app = app.clone();
        let sid = sid.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::with_capacity(256 * 1024, stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = emit_to_frontend(&app, &format!("claude:stderr:{}", sid), json!(line));
            }
        });
    }

    let mut translator = Translator::new(
        &start.cwd,
        start.resume_thread.clone(),
        start.model.clone(),
        start.effort,
        &start.mode,
        &launch.mcp_server,
    );
    let stream_event = format!("claude:stream:{}", sid);
    tokio::spawn(async move {
        let emit = |events: Vec<Value>| {
            for e in events {
                let _ = emit_to_frontend(&app, &stream_event, e);
            }
        };
        let first = translator.start();
        write_all(&mut child_stdin, &first.to_codex).await;
        let mut lines = BufReader::with_capacity(1024 * 1024, stdout).lines();
        loop {
            tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) => {
                        let out = translator.on_codex(&line);
                        write_all(&mut child_stdin, &out.to_codex).await;
                        emit(out.to_ui);
                        if out.fatal {
                            break;
                        }
                    }
                    _ => break,
                },
                Some(input) = rx.recv() => {
                    let out = translator.on_input(&input);
                    write_all(&mut child_stdin, &out.to_codex).await;
                    emit(out.to_ui);
                }
                _ = &mut kill_rx => {
                    eprintln!("[Stavebak] kill signal for Codex session {}", sid);
                    break;
                }
            }
        }
        drop(child_stdin);
        let _ = child.start_kill();
        let _ = child.wait().await;
        eprintln!("[Stavebak] Codex session {} ended (thread {:?})", sid, translator.thread_id());

        let _ = emit_to_frontend(&app, &stream_event, json!({ "type": "process_exit" }));
        let _ = emit_to_frontend(&app, &format!("claude:exit:{}", sid), json!(null));
        let _ = emit_to_frontend(&app, "sessions:changed", json!(null));
        procs.drop_entry(&sid).await;
        stdin_mgr.drop_entry(&sid).await;
        exit_notify.notify_one();
    });

    Ok(SessionInfo {
        stdin_id: start.sid,
        cli_session_id: start.resume_thread,
        pid,
        cli_path: bin.to_string_lossy().to_string(),
    })
}

// ── Instalace ───────────────────────────────────────────────────────────────

/// Balíček `codex-app-server-package` pro tuto platformu: (název v release, SHA-256).
/// Balíček, ne samotná binárka: nástroje (i MCP) model volá přes `exec`, které spouští
/// pomocné `codex-code-mode-host` vedle binárky. Součty z release `rust-v0.164.0` (pole `digest`).
fn release_asset() -> Option<(&'static str, &'static str)> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some(("codex-app-server-package-aarch64-apple-darwin.tar.gz", "7fcd5f0346c9338dd45f1af7c53115a29f651ac61a4264e2dbca49b7aa064ac0"))
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some(("codex-app-server-package-x86_64-apple-darwin.tar.gz", "125dea1f429558275a6cd73dfc7f20cc823193c1a61ee69222af250ae04e9762"))
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some(("codex-app-server-package-x86_64-pc-windows-msvc.tar.gz", "e177a62037b0b6b26774700f07a713db67f85efd2187c6a574c7a6a14ebf4b7e"))
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        Some(("codex-app-server-package-aarch64-pc-windows-msvc.tar.gz", "80dd56064d111b6c1e0fb45e48fb89c5b767cb3ee1b7f172cc9ef9f864cd3047"))
    } else {
        None
    }
}

fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(data).iter().map(|b| format!("{:02x}", b)).collect()
}

/// Rozbalí balíček do `dir` beze změn. Cesty mimo `dir` (absolutní, `..`) odmítne.
fn unpack_package(archive: &[u8], dir: &Path) -> Result<(), String> {
    let gz = flate2::read::GzDecoder::new(archive);
    let mut tar = tar::Archive::new(gz);
    tar.set_preserve_permissions(true);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut e = entry.map_err(|e| e.to_string())?;
        let path = e.path().map_err(|e| e.to_string())?.to_path_buf();
        if path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(format!("Neplatná cesta v balíčku Codexu: {}", path.display()));
        }
        // unpack_in sám odmítne cesty mimo dir; vrací false u přeskočených položek
        e.unpack_in(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stáhne připnutý balíček z GitHub release OpenAI, ověří SHA-256 a rozbalí do runtime_dir.
/// Nic se neupravuje.
pub async fn install_binary(progress: impl Fn(u8)) -> Result<PathBuf, String> {
    use futures_util::StreamExt;
    let (asset, sha) = release_asset().ok_or("Codex pro tuto platformu zatím nepodporujeme.")?;
    let url = format!("https://github.com/openai/codex/releases/download/rust-v{CODEX_VERSION}/{asset}");
    let res = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Stažení Codexu selhalo: {}", e))?;
    let total = res.content_length().unwrap_or(0);
    let mut data = Vec::with_capacity(total as usize);
    let mut stream = res.bytes_stream();
    let mut last = 0u8;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stažení Codexu selhalo: {}", e))?;
        data.extend_from_slice(&chunk);
        if let Some(pct) = (data.len() as u64 * 100).checked_div(total) {
            let pct = pct.min(100) as u8;
            if pct != last {
                last = pct;
                progress(pct);
            }
        }
    }
    if sha256_hex(&data) != sha {
        return Err("Stažený Codex neodpovídá kontrolnímu součtu, instalace zrušena.".into());
    }
    let target = runtime_dir().ok_or("Chybí domovská složka")?;
    let parent = target.parent().ok_or("Chybí domovská složka")?.to_path_buf();
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!("{CODEX_VERSION}.download"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    unpack_package(&data, &tmp)?;
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    find_binary().ok_or_else(|| "V balíčku Codexu chybí codex-app-server".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(auth: CodexAuth, token: Option<&str>) -> LaunchConfig {
        LaunchConfig {
            auth,
            codex_home: PathBuf::from("/tmp/codex-home"),
            mcp_server: "stavebak".into(),
            mcp_url: "http://localhost:3535/mcp".into(),
            stavebak_token: token.map(String::from),
            model_catalog: None,
        }
    }

    fn line(v: Value) -> String {
        v.to_string()
    }

    /// Projde handshake až po otevřené vlákno.
    fn ready(t: &mut Translator) -> Out {
        let start = t.start();
        assert_eq!(start.to_codex[0]["method"], "initialize");
        assert_eq!(start.to_codex[0]["params"]["clientInfo"]["name"], CLIENT_NAME);
        let o = t.on_codex(&line(json!({ "id": 1, "result": { "userAgent": "x" } })));
        assert_eq!(o.to_codex[0]["method"], "initialized");
        assert_eq!(o.to_codex[1]["method"], "thread/start");
        t.on_codex(&line(json!({ "id": 2, "result": { "thread": { "id": "th_1" }, "model": "gpt-6-sol" } })))
    }

    #[test]
    fn tokeny_nejsou_v_argumentech_a_prikazy_je_nededi() {
        let c = cfg(CodexAuth::ChatgptPlan("SECRET-ACCESS".into()), Some("SECRET-STAVEBAK"));
        let args = launch_args(&c).join(" ");
        assert!(!args.contains("SECRET"));
        assert!(args.contains("env_key=\"ACCESS_TOKEN\""));
        assert!(args.contains("bearer_token_env_var=\"STAVEBAK_TOKEN\""));
        assert!(args.contains("shell_environment_policy.exclude=[\"ACCESS_TOKEN\",\"OPENAI_API_KEY\",\"STAVEBAK_TOKEN\"]"));
        assert!(args.contains("requires_openai_auth=false"));
        let env = launch_env(&c);
        assert!(env.contains(&("ACCESS_TOKEN".into(), "SECRET-ACCESS".into())));
        assert!(env.contains(&("CODEX_HOME".into(), "/tmp/codex-home".into())));
        assert!(!format!("{:?}", c).contains("SECRET-ACCESS"));
    }

    #[test]
    fn api_klic_jako_vlastni_provider_bez_mcp_tokenu() {
        let c = cfg(CodexAuth::ApiKey("sk-x".into()), None);
        let args = launch_args(&c).join(" ");
        assert!(args.contains("model_provider=\"openai_api_key\""));
        assert!(args.contains("env_key=\"OPENAI_API_KEY\""));
        assert!(!args.contains("bearer_token_env_var"));
    }

    #[test]
    fn katalog_vypne_tool_search() {
        let src = json!({ "models": [{ "slug": "a", "supports_search_tool": true }, { "slug": "b", "supports_search_tool": true }] });
        let out = catalog_without_tool_search(&src);
        assert_eq!(out["models"][0]["supports_search_tool"], false);
        assert_eq!(out["models"][1]["supports_search_tool"], false);
        assert_eq!(out["models"][1]["slug"], "b");
    }

    #[test]
    fn zprava_pred_otevrenim_vlakna_se_posle_po_nem() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        t.start();
        let early = t.on_input(&line(json!({ "type": "user", "message": { "role": "user", "content": "Ahoj" } })));
        assert!(early.to_codex.is_empty());
        t.on_codex(&line(json!({ "id": 1, "result": {} })));
        let o = t.on_codex(&line(json!({ "id": 2, "result": { "thread": { "id": "th_1" }, "model": "gpt-6-sol" } })));
        assert_eq!(o.to_ui[0]["type"], "system");
        assert_eq!(o.to_ui[0]["subtype"], "init");
        assert_eq!(o.to_ui[0]["session_id"], "th_1");
        assert_eq!(o.to_codex[0]["method"], "turn/start");
        assert_eq!(o.to_codex[0]["params"]["input"][0]["text"], "Ahoj");
    }

    #[test]
    fn obnova_vlakna() {
        let mut t = Translator::new("/p", Some("th_9".into()), None, None, "plan", "stavebak");
        t.start();
        let o = t.on_codex(&line(json!({ "id": 1, "result": {} })));
        assert_eq!(o.to_codex[1]["method"], "thread/resume");
        assert_eq!(o.to_codex[1]["params"]["threadId"], "th_9");
        assert_eq!(o.to_codex[1]["params"]["sandbox"], "read-only");
    }

    #[test]
    fn text_nastroj_a_konec_tahu() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        let o = t.on_input(&line(json!({ "type": "user", "message": { "content": [{ "type": "text", "text": "Zařaď RD" }] } })));
        assert_eq!(o.to_codex[0]["method"], "turn/start");
        t.on_codex(&line(json!({ "id": 3, "result": { "turn": { "id": "tu_1", "status": "inProgress" } } })));

        let d = t.on_codex(&line(json!({ "method": "item/agentMessage/delta", "params": { "itemId": "m1", "delta": "Dobře" } })));
        assert_eq!(d.to_ui[0]["event"]["delta"]["text"], "Dobře");

        let s = t.on_codex(&line(json!({ "method": "item/started", "params": { "item": {
            "type": "mcpToolCall", "id": "call_1", "server": "stavebak", "tool": "classify_project",
            "status": "inProgress", "arguments": { "buildingType": "family-house" } } } })));
        let block = &s.to_ui[0]["message"]["content"][0];
        assert_eq!(block["name"], "mcp__stavebak__classify_project");
        assert_eq!(block["input"]["buildingType"], "family-house");

        let c = t.on_codex(&line(json!({ "method": "item/completed", "params": { "item": {
            "type": "mcpToolCall", "id": "call_1", "server": "stavebak", "tool": "classify_project",
            "status": "completed", "result": { "content": [{ "type": "text", "text": "{\"kategorie\":\"II\"}" }] } } } })));
        assert_eq!(c.to_ui[0]["type"], "user");
        assert_eq!(c.to_ui[0]["message"]["content"][0]["tool_use_id"], "call_1");
        assert_eq!(c.to_ui[0]["message"]["content"][0]["is_error"], false);

        let m = t.on_codex(&line(json!({ "method": "item/completed", "params": { "item": { "type": "agentMessage", "id": "m1", "text": "Dobře, RD je II." } } })));
        assert_eq!(m.to_ui[0]["message"]["content"][0]["text"], "Dobře, RD je II.");

        t.on_codex(&line(json!({ "method": "thread/tokenUsage/updated", "params": { "tokenUsage": { "last": { "inputTokens": 120, "outputTokens": 30, "cachedInputTokens": 100 } } } })));
        let done = t.on_codex(&line(json!({ "method": "turn/completed", "params": { "turn": { "id": "tu_1", "status": "completed" } } })));
        assert_eq!(done.to_ui[0]["type"], "result");
        assert_eq!(done.to_ui[0]["subtype"], "success");
        assert_eq!(done.to_ui[0]["usage"]["input_tokens"], 120);
        assert_eq!(done.to_ui[0]["session_id"], "th_1");
    }

    #[test]
    fn schvaleni_prikazu_tam_a_zpet() {
        let mut t = Translator::new("/p", None, None, None, "default", "stavebak");
        ready(&mut t);
        let o = t.on_codex(&line(json!({ "id": 77, "method": "item/commandExecution/requestApproval",
            "params": { "itemId": "cmd_1", "command": "ls -la", "reason": "Výpis složky" } })));
        let req = &o.to_ui[0];
        assert_eq!(req["type"], "stavebak_permission_request");
        assert_eq!(req["tool_name"], "Bash");
        assert_eq!(req["request_id"], "codex:77");
        assert_eq!(req["input"]["command"], "ls -la");

        let allow = t.on_input(&line(json!({ "type": "control_response", "response": {
            "subtype": "success", "request_id": "codex:77", "response": { "behavior": "allow", "updatedInput": {} } } })));
        assert_eq!(allow.to_codex[0], json!({ "id": 77, "result": { "decision": "accept" } }));

        let deny = t.on_input(&line(json!({ "type": "control_response", "response": {
            "request_id": "codex:78", "response": { "behavior": "deny", "message": "ne" } } })));
        assert_eq!(deny.to_codex[0]["result"]["decision"], "decline");
    }

    #[test]
    fn stop_preruseni_tahu() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        t.on_input(&line(json!({ "type": "user", "message": { "content": "dlouhá práce" } })));
        t.on_codex(&line(json!({ "id": 3, "result": { "turn": { "id": "tu_1" } } })));
        let o = t.on_input(&line(json!({ "type": "control_request", "request_id": "r1", "request": { "subtype": "interrupt" } })));
        assert_eq!(o.to_codex[0]["method"], "turn/interrupt");
        assert_eq!(o.to_codex[0]["params"]["turnId"], "tu_1");
        let end = t.on_codex(&line(json!({ "method": "turn/completed", "params": { "turn": { "id": "tu_1", "status": "interrupted" } } })));
        assert_eq!(end.to_ui[0]["subtype"], "user_abort");
    }

    #[test]
    fn zprava_behem_tahu_jde_do_beziciho_tahu() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        t.on_input(&line(json!({ "type": "user", "message": { "content": "první" } })));
        t.on_codex(&line(json!({ "id": 3, "result": { "turn": { "id": "tu_1" } } })));
        let o = t.on_input(&line(json!({ "type": "user", "message": { "content": "ještě tohle" } })));
        assert_eq!(o.to_codex[0]["method"], "turn/steer");
        assert_eq!(o.to_codex[0]["params"]["expectedTurnId"], "tu_1");
    }

    #[test]
    fn zmena_rezimu_a_modelu_plati_od_dalsiho_tahu() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        t.on_input(&line(json!({ "type": "control_request", "request": { "subtype": "set_permission_mode", "mode": "plan" } })));
        t.on_input(&line(json!({ "type": "control_request", "request": { "subtype": "set_model", "model": "gpt-6-luna" } })));
        let o = t.on_input(&line(json!({ "type": "user", "message": { "content": "dál" } })));
        let p = &o.to_codex[0]["params"];
        assert_eq!(p["approvalPolicy"], "on-request");
        assert_eq!(p["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(p["model"], "gpt-6-luna");
    }

    #[test]
    fn chyby_tahu_a_limit_planu() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        let o = t.on_codex(&line(json!({ "method": "turn/completed", "params": { "turn": { "id": "tu_1", "status": "failed",
            "error": { "message": "429", "codexErrorInfo": "usageLimitExceeded" } } } })));
        assert_eq!(o.to_ui[0]["subtype"], "error_during_execution");
        assert!(o.to_ui[0]["result"].as_str().unwrap().contains("chatgpt.com/settings/usage"));
        let u = t.on_codex(&line(json!({ "method": "turn/completed", "params": { "turn": { "status": "failed",
            "error": { "message": "401", "codexErrorInfo": "unauthorized" } } } })));
        assert!(u.to_ui[0]["result"].as_str().unwrap().contains("Přihlaste se znovu"));
    }

    #[test]
    fn nepodporovane_pozadavky_serveru_se_odmitnou() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        let o = t.on_codex(&line(json!({ "id": 5, "method": "item/tool/call", "params": {} })));
        assert_eq!(o.to_codex[0]["id"], 5);
        assert_eq!(o.to_codex[0]["error"]["code"], -32601);
        let e = t.on_codex(&line(json!({ "id": 6, "method": "mcpServer/elicitation/request", "params": { "serverName": "stavebak" } })));
        assert_eq!(e.to_codex[0]["result"]["action"], "decline");
    }

    #[test]
    fn plan_jako_karta_ukolu() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        ready(&mut t);
        let o = t.on_codex(&line(json!({ "method": "turn/plan/updated", "params": { "turnId": "tu_1",
            "plan": [{ "step": "Zařadit stavbu", "status": "completed" }, { "step": "Zkontrolovat ÚP", "status": "inProgress" }] } })));
        let b = &o.to_ui[0]["message"]["content"][0];
        assert_eq!(b["name"], "TodoWrite");
        assert_eq!(b["id"], "codex_plan_tu_1");
        assert_eq!(b["input"]["todos"][1]["status"], "in_progress");
    }

    #[test]
    fn modely_a_usili() {
        assert_eq!(codex_model(Some("sonnet")), None);
        assert_eq!(codex_model(Some("opus[1m]")), None);
        assert_eq!(codex_model(Some("gpt-6-sol")), Some("gpt-6-sol".into()));
        assert_eq!(codex_model(Some("o4-mini")), Some("o4-mini".into()));
        assert_eq!(codex_effort(Some("max")), Some("xhigh"));
        assert_eq!(codex_effort(Some("off")), None);
    }

    fn tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let gz = flate2::write::GzEncoder::new(&mut out, flate2::Compression::fast());
            let mut b = tar::Builder::new(gz);
            for (name, data) in entries {
                let mut h = tar::Header::new_gnu();
                h.set_size(data.len() as u64);
                h.set_mode(0o755);
                h.set_cksum();
                b.append_data(&mut h, name, *data).unwrap();
            }
            b.into_inner().unwrap().finish().unwrap();
        }
        out
    }

    #[test]
    fn rozbali_balicek_vcetne_pomocnych_binarek() {
        let dir = std::env::temp_dir().join(format!("codex-pkg-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let pkg = tar_gz(&[
            ("bin/codex-app-server", b"#!/bin/sh\necho server"),
            ("bin/codex-code-mode-host", b"#!/bin/sh\necho host"),
            ("codex-path/rg", b"rg"),
        ]);
        unpack_package(&pkg, &dir).unwrap();
        assert!(dir.join("bin/codex-app-server").is_file());
        assert!(dir.join("bin/codex-code-mode-host").is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("bin/codex-app-server")).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111);
        }
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn neuplne_vlakno_ukonci_proces() {
        let mut t = Translator::new("/p", None, None, None, "acceptEdits", "stavebak");
        t.start();
        t.on_codex(&line(json!({ "id": 1, "result": {} })));
        let o = t.on_codex(&line(json!({ "id": 2, "error": { "code": -32000, "message": "thread not found" } })));
        assert!(o.fatal);
        assert_eq!(o.to_ui[0]["subtype"], "error");
    }
}
