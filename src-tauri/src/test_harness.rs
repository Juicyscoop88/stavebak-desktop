//! Debug-only GUI test harness for `scripts/stavebak-cli.mjs`.
//!
//! Speaks the NDJSON protocol the CLI expects:
//! request `{command, payload, id, token?}` → response `{id, success, data?, error?}`.
//!
//! Transport:
//! - Unix: socket at `SOCKET_PATH`, reachable only by the current user (file permissions).
//! - Windows: TCP on `127.0.0.1` with a random port. Any local process can reach a TCP port,
//!   so every request must carry the random token. Port and token are written to
//!   `%TEMP%\stavebak-test.json` (per-user temp dir), where the CLI reads them.
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
use tauri::{AppHandle, Emitter, Listener};
#[cfg(target_os = "macos")]
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

#[cfg(unix)]
pub const SOCKET_PATH: &str = "/tmp/stavebak-test.sock";
#[cfg(windows)]
const DISCOVERY_FILE: &str = "stavebak-test.json";
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

    tauri::async_runtime::spawn(listen(app.clone(), pending));
}

#[cfg(unix)]
async fn listen(app: AppHandle, pending: Pending) {
    let _ = std::fs::remove_file(SOCKET_PATH);
    let listener = match tokio::net::UnixListener::bind(SOCKET_PATH) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[Stavebak] Test harness failed to bind {}: {}", SOCKET_PATH, e);
            return;
        }
    };
    eprintln!("[Stavebak] Test harness registered on {}", SOCKET_PATH);

    while let Ok((stream, _)) = listener.accept().await {
        tauri::async_runtime::spawn(serve(stream, app.clone(), pending.clone(), None));
    }
}

#[cfg(windows)]
async fn listen(app: AppHandle, pending: Pending) {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[Stavebak] Test harness failed to bind 127.0.0.1: {}", e);
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            eprintln!("[Stavebak] Test harness has no local address: {}", e);
            return;
        }
    };
    let token = Arc::new(uuid::Uuid::new_v4().to_string());
    let file = std::env::temp_dir().join(DISCOVERY_FILE);
    let discovery = json!({ "port": port, "token": token.as_str(), "pid": std::process::id() });
    if let Err(e) = std::fs::write(&file, discovery.to_string()) {
        eprintln!("[Stavebak] Test harness failed to write {}: {}", file.display(), e);
        return;
    }
    eprintln!("[Stavebak] Test harness registered on 127.0.0.1:{} ({})", port, file.display());

    while let Ok((stream, _)) = listener.accept().await {
        tauri::async_runtime::spawn(serve(stream, app.clone(), pending.clone(), Some(token.clone())));
    }
}

/// One client connection: NDJSON requests in, responses out. With `token`, a request
/// without the matching token gets an error and the connection is closed.
async fn serve<S>(stream: S, app: AppHandle, pending: Pending, token: Option<Arc<String>>)
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
        let id = req.get("id").cloned().unwrap_or(Value::Null);

        let authorized = match &token {
            Some(t) => req.get("token").and_then(Value::as_str) == Some(t.as_str()),
            None => true,
        };
        let mut resp = if !authorized {
            json!({ "success": false, "error": "invalid harness token" })
        } else {
            let command = req.get("command").and_then(Value::as_str).unwrap_or("");
            let payload = req.get("payload").cloned().unwrap_or(Value::Null);
            match handle(&app, &pending, command, &payload).await {
                Ok(data) => json!({ "success": true, "data": data }),
                Err(error) => json!({ "success": false, "error": error }),
            }
        };
        resp["id"] = id;
        let mut out = resp.to_string();
        out.push('\n');
        if write.write_all(out.as_bytes()).await.is_err() || !authorized {
            break;
        }
    }
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
