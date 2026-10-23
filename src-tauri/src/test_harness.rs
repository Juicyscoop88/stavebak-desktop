//! Debug-only GUI test harness for `scripts/stavebak-cli.mjs`.
//!
//! Listens on a Unix socket and speaks the NDJSON protocol the CLI expects:
//! request `{command, payload, id}` → response `{id, success, data?, error?}`.
//!
//! Supported commands:
//! - `ping`             → echoes `payload.value`
//! - `execute_js`       → evaluates `payload.code` in the main webview
//!                        (via the `harness://eval` event, answered on `harness://reply`)
//! - `get_dom`          → `document.documentElement.outerHTML`
//! - `take_screenshot`  → `screencapture` of the main window (macOS)
//!
//! Only compiled into debug builds (`cfg(debug_assertions)` at the call site).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::oneshot;

pub const SOCKET_PATH: &str = "/tmp/stavebak-test.sock";
const EVAL_TIMEOUT: Duration = Duration::from_secs(30);

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

pub fn start(app: &AppHandle) {
    keep_rendering_when_occluded(app);
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

    // Webview answers every `harness://eval` with `{reqId, result?, error?}`.
    let replies = pending.clone();
    app.listen_any("harness://reply", move |event| {
        let Ok(msg) = serde_json::from_str::<Value>(event.payload()) else { return };
        let Some(req_id) = msg.get("reqId").and_then(Value::as_str) else { return };
        if let Some(tx) = replies.lock().unwrap().remove(req_id) {
            let _ = tx.send(msg);
        }
    });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = std::fs::remove_file(SOCKET_PATH);
        let listener = match UnixListener::bind(SOCKET_PATH) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[Stavebak] Test harness failed to bind {}: {}", SOCKET_PATH, e);
                return;
            }
        };
        eprintln!("[Stavebak] Test harness registered on {}", SOCKET_PATH);

        while let Ok((stream, _)) = listener.accept().await {
            let app = app.clone();
            let pending = pending.clone();
            tauri::async_runtime::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
                    let id = req.get("id").cloned().unwrap_or(Value::Null);
                    let command = req.get("command").and_then(Value::as_str).unwrap_or("");
                    let payload = req.get("payload").cloned().unwrap_or(Value::Null);

                    let mut resp = match handle(&app, &pending, command, &payload).await {
                        Ok(data) => json!({ "success": true, "data": data }),
                        Err(error) => json!({ "success": false, "error": error }),
                    };
                    resp["id"] = id;
                    let mut out = resp.to_string();
                    out.push('\n');
                    if write.write_all(out.as_bytes()).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
}

async fn handle(app: &AppHandle, pending: &Pending, command: &str, payload: &Value) -> Result<Value, String> {
    match command {
        "ping" => Ok(json!({ "value": payload.get("value").cloned().unwrap_or(Value::Null) })),
        "execute_js" => {
            let code = payload.get("code").and_then(Value::as_str).ok_or("missing payload.code")?;
            eval(app, pending, code).await
        }
        "get_dom" => {
            let data = eval(app, pending, "document.documentElement.outerHTML").await?;
            Ok(data.get("result").cloned().unwrap_or(Value::Null))
        }
        "take_screenshot" => screenshot(app).await,
        other => Err(format!("Unsupported harness command: {}", other)),
    }
}

/// Evaluate JS in the main webview. Returns `{result}` or `{type: "error", error}`,
/// matching the shape `stavebak-cli.mjs` reads from `resp.data`.
async fn eval(app: &AppHandle, pending: &Pending, code: &str) -> Result<Value, String> {
    let req_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    pending.lock().unwrap().insert(req_id.clone(), tx);

    if let Err(e) = app.emit_to("main", "harness://eval", json!({ "reqId": req_id, "code": code })) {
        pending.lock().unwrap().remove(&req_id);
        return Err(format!("emit failed: {}", e));
    }

    match tokio::time::timeout(EVAL_TIMEOUT, rx).await {
        Ok(Ok(msg)) => match msg.get("error").and_then(Value::as_str) {
            Some(err) => Ok(json!({ "type": "error", "error": err })),
            None => Ok(json!({ "result": msg.get("result").cloned().unwrap_or(Value::Null) })),
        },
        _ => {
            pending.lock().unwrap().remove(&req_id);
            Err("execute_js timed out (is the webview listener mounted?)".into())
        }
    }
}

/// WebKit marks a covered window's page as `hidden` and stops committing
/// React updates, so harness-driven clicks never repaint while the app sits
/// behind the editor. Turn occlusion detection off for the main webview.
#[cfg(target_os = "macos")]
fn keep_rendering_when_occluded(app: &AppHandle) {
    use objc::runtime::{Object, BOOL, NO};
    use objc::{msg_send, sel, sel_impl};

    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        let wk = webview.inner() as *mut Object;
        let sel = sel!(_setWindowOcclusionDetectionEnabled:);
        let supported: BOOL = msg_send![wk, respondsToSelector: sel];
        if supported != NO {
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: NO];
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn keep_rendering_when_occluded(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
async fn screenshot(app: &AppHandle) -> Result<Value, String> {
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};

    let window = app.get_webview_window("main").ok_or("main window not found")?;
    let (tx, rx) = oneshot::channel::<Result<isize, String>>();
    let win = window.clone();
    window
        .run_on_main_thread(move || {
            let res = win.ns_window().map_err(|e| e.to_string()).map(|ns| {
                let ns = ns as *mut Object;
                let num: isize = unsafe { msg_send![ns, windowNumber] };
                num
            });
            let _ = tx.send(res);
        })
        .map_err(|e| e.to_string())?;
    let window_number = rx.await.map_err(|e| e.to_string())??;

    let path = format!(
        "/tmp/stavebak-shot-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let status = tokio::process::Command::new("screencapture")
        .args(["-x", "-o", "-l", &window_number.to_string(), &path])
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("screencapture exited with {}", status));
    }
    Ok(json!({ "filePath": path }))
}

#[cfg(not(target_os = "macos"))]
async fn screenshot(_app: &AppHandle) -> Result<Value, String> {
    Err("take_screenshot is only implemented on macOS".into())
}
