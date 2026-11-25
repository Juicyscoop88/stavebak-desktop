//! Historie konverzací s Codexem (docs/spec-codex-provider.md, Historie konverzací).
//!
//! Codex ukládá každé vlákno do `$CODEX_HOME/sessions/RRRR/MM/DD/rollout-*.jsonl`. Seznam
//! konverzací z nich bere vlákna, která založil desktop (`originator` = `Stavebak Desktop`),
//! a pro zobrazení je převede do tvaru řádků historie Claude Code, který zná parser chatu
//! (`user` / `assistant` s bloky `text`, `tool_use`, `tool_result`). Pokračování konverzace
//! obstará `thread/resume` v `codex_bridge` podle `id` vlákna.

use serde_json::{json, Value};
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::codex_bridge::CLIENT_NAME;

/// Složka s vlákny Codexu: `~/.stavebak/codex/sessions`.
pub fn sessions_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".stavebak").join("codex").join("sessions"))
}

/// Patří soubor do historie Codexu? (Pro načtení a smazání konverzace.)
pub fn is_rollout(path: &Path) -> bool {
    let Some(dir) = sessions_dir() else { return false };
    let Ok(canonical) = path.canonicalize() else { return false };
    let dir = dir.canonicalize().unwrap_or(dir);
    canonical.starts_with(&dir) && path.extension().is_some_and(|e| e == "jsonl")
}

/// Všechny soubory `rollout-*.jsonl` pod `dir` (rekurzivně přes rok/měsíc/den).
fn rollout_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rollout_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "jsonl")
            && path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("rollout-"))
        {
            out.push(path);
        }
    }
}

/// Položka seznamu konverzací ve stejném tvaru jako u Claude, navíc `provider: "codex"`.
/// Vlákna jiných aplikací a vlákna bez zprávy uživatele vynechá.
fn list_item(path: &Path) -> Option<Value> {
    let file = std::fs::File::open(path).ok()?;
    let mut lines = std::io::BufReader::new(file).lines().map_while(Result::ok);
    let meta: Value = serde_json::from_str(&lines.next()?).ok()?;
    if meta["type"] != "session_meta" || meta["payload"]["originator"] != CLIENT_NAME {
        return None;
    }
    let id = meta["payload"]["id"].as_str()?.to_string();
    let cwd = meta["payload"]["cwd"].as_str().unwrap_or_default().to_string();
    let preview = lines.find_map(|l| {
        let v: Value = serde_json::from_str(&l).ok()?;
        let item = completed_item(&v)?;
        (item["type"] == "UserMessage").then(|| item_text(item)).filter(|t| !t.is_empty())
    })?;
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(json!({
        "id": id,
        "path": path.to_string_lossy(),
        "project": cwd,
        "projectDir": cwd.replace(['/', '\\'], "-"),
        "modifiedAt": modified,
        "preview": preview.chars().take(200).collect::<String>(),
        "provider": "codex",
    }))
}

/// Konverzace s Codexem založené desktopem.
pub fn list_sessions() -> Vec<Value> {
    let Some(dir) = sessions_dir() else { return vec![] };
    let mut files = vec![];
    rollout_files(&dir, &mut files);
    files.iter().filter_map(|p| list_item(p)).collect()
}

/// Dokončená položka vlákna (`event_msg` `item_completed`), jinak None.
fn completed_item(line: &Value) -> Option<&Value> {
    (line["type"] == "event_msg" && line["payload"]["type"] == "item_completed")
        .then(|| &line["payload"]["item"])
}

fn item_text(item: &Value) -> String {
    item["content"]
        .as_array()
        .map(|blocks| blocks.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

fn user(ts: &Value, content: Value) -> Value {
    json!({ "type": "user", "timestamp": ts, "message": { "role": "user", "content": content } })
}

fn assistant(ts: &Value, block: Value) -> Value {
    json!({ "type": "assistant", "timestamp": ts, "message": { "role": "assistant", "content": [block] } })
}

/// Nástroj ve stejném pojmenování jako za běhu (`codex_bridge`): `mcp__<server>__<tool>`, `Bash`, `Write`/`Edit`.
fn tool_use(item: &Value) -> Option<(Value, String, bool)> {
    let id = item["id"].as_str()?;
    let failed = matches!(item["status"].as_str(), Some("failed" | "declined"));
    let (name, input, output) = match item["type"].as_str()? {
        "McpToolCall" => {
            let output = item["error"]["message"].as_str().map(str::to_string).unwrap_or_else(|| {
                item["result"]["content"]
                    .as_array()
                    .map(|c| c.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"))
                    .unwrap_or_default()
            });
            let name = format!(
                "mcp__{}__{}",
                item["server"].as_str().unwrap_or_default(),
                item["tool"].as_str().unwrap_or_default()
            );
            let args = if item["arguments"].is_null() { json!({}) } else { item["arguments"].clone() };
            (name, args, output)
        }
        "CommandExecution" => {
            // ["/bin/zsh", "-lc", "<příkaz>"]: zobrazit jen příkaz
            let command = item["command"]
                .as_array()
                .and_then(|a| a.last())
                .and_then(|c| c.as_str())
                .or(item["command"].as_str())
                .unwrap_or_default();
            let output = item["aggregated_output"].as_str().unwrap_or_default().to_string();
            ("Bash".to_string(), json!({ "command": command, "description": "" }), output)
        }
        "FileChange" => {
            let changes = item["changes"].as_object()?;
            let (path, change) = changes.iter().next()?;
            let added = changes.len() == 1 && change["type"] == "add";
            let diff = changes
                .values()
                .filter_map(|c| c["unified_diff"].as_str().or(c["content"].as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            let output = if failed { "Změnu se nepodařilo zapsat." } else { "Hotovo." }.to_string();
            let name = if added { "Write" } else { "Edit" };
            (name.to_string(), json!({ "file_path": path, "diff": diff }), output)
        }
        _ => return None,
    };
    Some((json!({ "type": "tool_use", "id": id, "name": name, "input": input }), output, failed))
}

/// Řádky vlákna Codexu → řádky historie ve tvaru Claude Code pro `parseSessionMessages`.
pub fn to_history(lines: &[Value]) -> Vec<Value> {
    let mut out = vec![];
    for line in lines {
        let Some(item) = completed_item(line) else { continue };
        let ts = &line["timestamp"];
        match item["type"].as_str() {
            Some("UserMessage") => {
                let text = item_text(item);
                if !text.is_empty() {
                    out.push(user(ts, json!(text)));
                }
            }
            Some("AgentMessage") => {
                let text = item_text(item);
                if !text.is_empty() {
                    out.push(assistant(ts, json!({ "type": "text", "text": text })));
                }
            }
            _ => {
                if let Some((block, output, is_error)) = tool_use(item) {
                    let id = block["id"].clone();
                    out.push(assistant(ts, block));
                    out.push(user(
                        ts,
                        json!([{ "type": "tool_result", "tool_use_id": id, "content": output, "is_error": is_error }]),
                    ));
                }
            }
        }
    }
    out
}

/// Načte vlákno ze souboru a převede ho pro chat.
pub fn load(path: &Path) -> Result<Vec<Value>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open session: {e}"))?;
    let lines: Vec<Value> = std::io::BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|l| serde_json::from_str(&l).ok())
        .collect();
    Ok(to_history(&lines))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn done(item: Value) -> Value {
        json!({ "timestamp": "2026-11-25T10:00:00Z", "type": "event_msg",
                "payload": { "type": "item_completed", "item": item } })
    }

    #[test]
    fn zpravy_a_nastroje_ve_tvaru_historie_claude() {
        let lines = vec![
            json!({ "type": "session_meta", "payload": { "id": "t1", "originator": CLIENT_NAME } }),
            json!({ "type": "response_item", "payload": { "type": "message", "role": "developer" } }),
            done(json!({ "type": "UserMessage", "id": "u1", "content": [{ "type": "text", "text": "Zařaď stavbu" }] })),
            done(json!({ "type": "Reasoning", "id": "r1", "summary_text": [] })),
            done(json!({ "type": "McpToolCall", "id": "c1", "server": "stavebak", "tool": "classify_project",
                         "arguments": { "type": "rd" }, "status": "completed",
                         "result": { "content": [{ "type": "text", "text": "Stavba je RD." }] } })),
            done(json!({ "type": "CommandExecution", "id": "c2", "command": ["/bin/zsh", "-lc", "ls"],
                         "aggregated_output": "a.txt\n", "status": "failed" })),
            done(json!({ "type": "FileChange", "id": "c3", "status": "completed",
                         "changes": { "/p/a.scr": { "type": "add", "content": "LINE" } } })),
            done(json!({ "type": "AgentMessage", "id": "a1", "content": [{ "type": "Text", "text": "Hotovo." }] })),
        ];
        let h = to_history(&lines);
        assert_eq!(h.len(), 8);
        assert_eq!(h[0]["type"], "user");
        assert_eq!(h[0]["message"]["content"], "Zařaď stavbu");
        assert_eq!(h[1]["message"]["content"][0]["name"], "mcp__stavebak__classify_project");
        assert_eq!(h[1]["message"]["content"][0]["input"]["type"], "rd");
        assert_eq!(h[2]["message"]["content"][0]["tool_use_id"], "c1");
        assert_eq!(h[2]["message"]["content"][0]["content"], "Stavba je RD.");
        assert_eq!(h[3]["message"]["content"][0]["input"]["command"], "ls");
        assert_eq!(h[4]["message"]["content"][0]["is_error"], true);
        assert_eq!(h[5]["message"]["content"][0]["name"], "Write");
        assert_eq!(h[5]["message"]["content"][0]["input"]["file_path"], "/p/a.scr");
        assert_eq!(h[7]["message"]["content"][0]["text"], "Hotovo.");
    }

    #[test]
    fn seznam_jen_vlakna_desktopu_se_zpravou() {
        let dir = std::env::temp_dir().join(format!("codex-history-{}", std::process::id()));
        let day = dir.join("2026/11/25");
        std::fs::create_dir_all(&day).unwrap();
        let write = |name: &str, lines: &[Value]| {
            let text: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            std::fs::write(day.join(name), text.join("\n")).unwrap();
        };
        let meta = |id: &str, originator: &str| {
            json!({ "type": "session_meta", "payload": { "id": id, "originator": originator, "cwd": "/projekt" } })
        };
        let msg = done(json!({ "type": "UserMessage", "id": "u", "content": [{ "type": "text", "text": "Ahoj" }] }));
        write("rollout-a.jsonl", &[meta("a", CLIENT_NAME), msg.clone()]);
        write("rollout-b.jsonl", &[meta("b", "codex_cli_rs"), msg]);
        write("rollout-c.jsonl", &[meta("c", CLIENT_NAME)]);

        let mut files = vec![];
        rollout_files(&dir, &mut files);
        let items: Vec<Value> = files.iter().filter_map(|p| list_item(p)).collect();
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], "a");
        assert_eq!(items[0]["project"], "/projekt");
        assert_eq!(items[0]["preview"], "Ahoj");
        assert_eq!(items[0]["provider"], "codex");
    }
}
