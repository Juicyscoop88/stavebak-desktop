//! HTTP přenos MCP pro `computer_use`: jen loopback a tajný klíč, stejné ochrany jako `mcp_bridge`.

use crate::computer_use::{handle_rpc, ComputerUse};
use crate::mcp_bridge::{check_request, full, random_key, Body, Bridge};
use http_body_util::{BodyExt, Limited};
use hyper::body::Incoming;
use hyper::{Method, Request, Response, StatusCode};
use std::convert::Infallible;
use std::sync::Arc;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;

struct Shared {
    engine: Arc<ComputerUse>,
    key: String,
    port: u16,
}

pub async fn start(engine: Arc<ComputerUse>) -> Result<Bridge, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("Server ovládání nejde spustit: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let key = random_key();
    let shared = Arc::new(Shared { engine, key: key.clone(), port });
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            let shared = shared.clone();
            tokio::spawn(async move {
                let svc = hyper::service::service_fn(move |req| handle(shared.clone(), req));
                let io = hyper_util::rt::TokioIo::new(stream);
                let _ = hyper::server::conn::http1::Builder::new().serve_connection(io, svc).await;
            });
        }
    });
    Ok(Bridge { url: format!("http://127.0.0.1:{port}/mcp"), key })
}

async fn handle(shared: Arc<Shared>, req: Request<Incoming>) -> Result<Response<Body>, Infallible> {
    if let Err((status, msg)) = check_request(&req, &shared.key, shared.port) {
        return Ok(full(status, "text/plain; charset=utf-8", msg));
    }
    // Server nic neposílá sám od sebe, GET stream ani ukončení session nepotřebuje
    if req.method() != Method::POST {
        return Ok(full(StatusCode::METHOD_NOT_ALLOWED, "text/plain; charset=utf-8", "Jen POST."));
    }
    let Ok(body) = Limited::new(req.into_body(), MAX_REQUEST_BYTES).collect().await else {
        return Ok(full(StatusCode::PAYLOAD_TOO_LARGE, "text/plain; charset=utf-8", "Požadavek je příliš velký."));
    };
    let Ok(message) = serde_json::from_slice::<serde_json::Value>(&body.to_bytes()) else {
        return Ok(full(StatusCode::BAD_REQUEST, "text/plain; charset=utf-8", "Neplatný JSON."));
    };
    // Dialog souhlasu a vstup blokují, nesmí držet vlákno runtime
    let engine = shared.engine.clone();
    let reply = tokio::task::spawn_blocking(move || handle_rpc(&engine, &message)).await.ok().flatten();
    Ok(match reply {
        Some(v) => full(StatusCode::OK, "application/json", v.to_string()),
        None => full(StatusCode::ACCEPTED, "text/plain; charset=utf-8", ""),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::computer_use::{Consent, Desktop, MouseButton, WindowInfo, GRANT_TTL};
    use crate::mcp_bridge::KEY_HEADER;
    use serde_json::{json, Value};
    use std::sync::Mutex;
    use xcap::image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};

    /// Falešná plocha: okno 2000×1000 na 100,50, snímek 1000×500 s červeným čtvercem kolem `target`.
    struct Fake {
        target: (i32, i32),
        clicks: Mutex<Vec<(i32, i32)>>,
    }

    impl Desktop for Fake {
        fn windows(&self) -> Result<Vec<WindowInfo>, String> {
            Ok(vec![WindowInfo { id: 1, app: "BricsCAD".into(), title: "vykres.dwg".into(), x: 100, y: 50, width: 2000, height: 1000, focused: true, minimized: false }])
        }
        fn capture(&self, _w: &WindowInfo, _m: u32) -> Result<(Vec<u8>, u32, u32), String> {
            let (tx, ty) = self.target;
            let image = RgbImage::from_fn(1000, 500, |x, y| {
                if (x as i32 - tx).abs() <= 20 && (y as i32 - ty).abs() <= 20 { Rgb([220, 20, 20]) } else { Rgb([245, 245, 245]) }
            });
            let mut jpeg = Vec::new();
            JpegEncoder::new_with_quality(&mut jpeg, 85).encode_image(&image).map_err(|e| e.to_string())?;
            Ok((jpeg, 1000, 500))
        }
        fn focus(&self, _w: &WindowInfo) -> Result<(), String> { Ok(()) }
        fn click(&self, x: i32, y: i32, _b: MouseButton, _n: u32) -> Result<(), String> {
            self.clicks.lock().unwrap().push((x, y));
            Ok(())
        }
        fn type_text(&self, _t: &str) -> Result<(), String> { Ok(()) }
        fn key(&self, _c: &[String]) -> Result<(), String> { Ok(()) }
        fn scroll(&self, _x: i32, _y: i32, _dx: i32, _dy: i32) -> Result<(), String> { Ok(()) }
        fn pointer(&self) -> Result<(i32, i32), String> {
            Ok(self.clicks.lock().unwrap().last().copied().unwrap_or((0, 0)))
        }
    }

    struct Yes;
    impl Consent for Yes {
        fn ask(&self, _a: &[String], _r: &[String], _t: &str) -> bool { true }
    }

    fn engine(fake: Arc<Fake>) -> Arc<ComputerUse> {
        Arc::new(ComputerUse::new(fake, Arc::new(Yes), GRANT_TTL, Box::new(|_, _| {})))
    }

    #[tokio::test]
    async fn http_requires_key_and_serves_tools() {
        let bridge = start(engine(Arc::new(Fake { target: (0, 0), clicks: Mutex::new(vec![]) }))).await.unwrap();
        let client = reqwest::Client::new();
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });

        let denied = client.post(&bridge.url).json(&body).send().await.unwrap();
        assert_eq!(denied.status(), 403);
        let browser = client.post(&bridge.url).header(KEY_HEADER, &bridge.key).header("origin", "https://zly.web").json(&body).send().await.unwrap();
        assert_eq!(browser.status(), 403);

        let ok: Value = client.post(&bridge.url).header(KEY_HEADER, &bridge.key).json(&body).send().await.unwrap().json().await.unwrap();
        assert_eq!(ok["result"]["tools"].as_array().unwrap().len(), 7);

        let note = client.post(&bridge.url).header(KEY_HEADER, &bridge.key).json(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).send().await.unwrap();
        assert_eq!(note.status(), 202);
    }

    /// Skutečný Claude Code proti falešné ploše: ověří protokol, obrázky a přesnost klikání.
    /// Stojí tokeny, proto ručně: `cargo test --lib claude_clicks -- --ignored --nocapture`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn claude_clicks_target_in_screenshot() {
        let dir = tempfile::tempdir().unwrap();
        let mut hits = 0;
        let targets = [(200, 120), (760, 390), (510, 60)];
        for target in targets {
            let fake = Arc::new(Fake { target, clicks: Mutex::new(vec![]) });
            let bridge = start(engine(fake.clone())).await.unwrap();
            let config = dir.path().join("mcp.json");
            std::fs::write(&config, json!({ "mcpServers": { "stavebak-computer": { "type": "http", "url": bridge.url, "headers": { KEY_HEADER: bridge.key } } } }).to_string()).unwrap();
            let tools = ["computer_list_apps", "computer_request_access", "computer_screenshot", "computer_click"].map(|t| format!("mcp__stavebak-computer__{t}")).join(",");
            let output = tokio::process::Command::new("claude")
                .args(["-p", "Požádej o přístup k aplikaci BricsCAD, udělej snímek jejího okna a jednou klikni doprostřed červeného čtverce. Nic dalšího nedělej.", "--model", "sonnet", "--output-format", "json", "--max-turns", "10", "--strict-mcp-config", "--mcp-config"])
                .arg(&config)
                .args(["--allowedTools", &tools])
                .current_dir(dir.path())
                .output()
                .await
                .unwrap();
            let clicks = fake.clicks.lock().unwrap().clone();
            // střed čtverce na obrazovce: okno 100,50 a dvojnásobné měřítko snímku
            let expected = (100 + target.0 * 2, 50 + target.1 * 2);
            let hit = clicks.iter().any(|(x, y)| (x - expected.0).abs() <= 40 && (y - expected.1).abs() <= 40);
            println!("cíl {expected:?}, kliky {clicks:?}, zásah {hit}");
            if !hit {
                println!("{}", String::from_utf8_lossy(&output.stdout).chars().take(800).collect::<String>());
            }
            hits += hit as i32;
        }
        assert_eq!(hits, targets.len() as i32, "model netrefil všechny cíle");
    }
}
