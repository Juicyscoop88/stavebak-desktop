//! Most mezi sessions modelu (Claude Code, Codex) a MCP serverem Stavebáku, rozhodnutí v ADR 0003.
//!
//! Session dostane adresu `http://127.0.0.1:<port>/mcp` a tajný klíč v hlavičce, nikdy přístupový token.
//! Most ke každému požadavku přidá platný token z `stavebak_auth` (obnoví ho, když vyprší), při 401
//! token obnoví a požadavek jednou zopakuje. Session tak běží hodiny i dny bez odpojení.
//!
//! Když přihlášení chybí nebo ho server odmítl, most vrátí chybu JSON-RPC se stavem 200, ne HTTP 401:
//! na 401 by klient spustil vlastní OAuth, které v aplikaci nejde dokončit, a server by do konce session
//! považoval za nepřipojený. Takhle model dostane návod („přihlaste se v aplikaci“) a po přihlášení
//! v aplikaci funguje další volání bez restartu konverzace.
//!
//! Ochrana: jen loopback, klíč z bezpečného generátoru (porovnání v konstantním čase), `Host` musí být
//! loopback s naším portem a požadavek s `Origin` (prohlížeč, DNS rebinding) se odmítne.

use crate::stavebak_auth::TokenState;
use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::{combinators::BoxBody, BodyExt, Full, Limited, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::{Method, Request, Response, StatusCode};
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// Hlavička s klíčem mostu (session ji posílá u každého požadavku).
pub const KEY_HEADER: &str = "x-stavebak-bridge-key";
/// Požadavky MCP jsou malé JSON-RPC zprávy, soubory jdou mimo protokol přes presigned URL.
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;

/// Hlavičky, které most předává serveru. Ostatní (Host, Origin, klíč mostu, Authorization klienta) ne.
const FORWARD_REQUEST_HEADERS: &[&str] = &[
    "accept",
    "content-type",
    "mcp-protocol-version",
    "mcp-session-id",
    "last-event-id",
    "user-agent",
];
/// Hlavičky odpovědi pro klienta. `www-authenticate` ne: klient by spustil vlastní OAuth.
const FORWARD_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "cache-control",
    "mcp-session-id",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
];

/// Jak se session modelu připojí ke Stavebáku.
#[derive(Clone)]
pub enum McpAccess {
    /// Běžně: přes most, session zná jen jeho adresu a klíč.
    Bridge { url: String, key: String },
    /// Most nejde spustit (nemá se stát): přímo na server s tokenem platným při startu, nebo anonymně.
    /// Token po vypršení neobnoví, proto jen jako záloha.
    Direct { url: String, token: Option<String> },
}

impl McpAccess {
    pub fn url(&self) -> &str {
        match self {
            McpAccess::Bridge { url, .. } | McpAccess::Direct { url, .. } => url,
        }
    }
}

/// Bez tajemství (klíč a token se do logů nedostanou).
impl std::fmt::Debug for McpAccess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            McpAccess::Bridge { url, .. } => write!(f, "Bridge({})", url),
            McpAccess::Direct { url, token } => write!(f, "Direct({}, token: {})", url, token.is_some()),
        }
    }
}

pub type TokenFuture<'a> = Pin<Box<dyn Future<Output = TokenState> + Send + 'a>>;

/// Zdroj tokenu (v aplikaci `stavebak_auth`, v testech náhrada).
pub trait TokenSource: Send + Sync {
    fn current(&self) -> TokenFuture<'_>;
    /// Server odmítl `rejected`: obnovit, nebo vrátit novější.
    fn after_rejection<'a>(&'a self, rejected: &'a str) -> TokenFuture<'a>;
}

pub type ClientFuture = Pin<Box<dyn Future<Output = reqwest::Client> + Send>>;

pub struct Config {
    /// Skutečný MCP server, např. `https://stavebak.cz/mcp`.
    pub upstream: String,
    pub tokens: Arc<dyn TokenSource>,
    /// HTTP klient k serveru (v aplikaci s nastavením proxy uživatele).
    pub client: Box<dyn Fn() -> ClientFuture + Send + Sync>,
    /// Model narazil na chybějící přihlášení: UI má nabídnout přihlášení.
    pub on_auth_required: Box<dyn Fn() + Send + Sync>,
}

/// Běžící most: kam se session připojí a jakým klíčem.
#[derive(Clone)]
pub struct Bridge {
    pub url: String,
    pub key: String,
}

struct Shared {
    cfg: Config,
    key: String,
    port: u16,
}

type Body = BoxBody<Bytes, std::io::Error>;

pub async fn start(cfg: Config) -> Result<Bridge, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Most MCP nejde spustit: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let key = random_key();
    let shared = Arc::new(Shared { cfg, key: key.clone(), port });
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
    Ok(Bridge { url: format!("http://127.0.0.1:{}/mcp", port), key })
}

fn random_key() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Smí požadavek přes most? Vrací důvod odmítnutí.
fn check_request<B>(req: &Request<B>, key: &str, port: u16) -> Result<(), (StatusCode, &'static str)> {
    let header = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok());
    let host_ok = header("host").is_some_and(|h| h == format!("127.0.0.1:{}", port) || h == format!("localhost:{}", port));
    if !host_ok || req.headers().contains_key("origin") {
        return Err((StatusCode::FORBIDDEN, "Požadavek mimo aplikaci Stavebák."));
    }
    if !header(KEY_HEADER).is_some_and(|k| constant_time_eq(k.as_bytes(), key.as_bytes())) {
        return Err((StatusCode::FORBIDDEN, "Neplatný klíč mostu."));
    }
    if req.uri().path() != "/mcp" {
        return Err((StatusCode::NOT_FOUND, "Neznámá cesta."));
    }
    if ![Method::POST, Method::GET, Method::DELETE].contains(req.method()) {
        return Err((StatusCode::METHOD_NOT_ALLOWED, "Nepodporovaná metoda."));
    }
    Ok(())
}

fn full(status: StatusCode, content_type: &str, body: impl Into<Bytes>) -> Response<Body> {
    let mut res = Response::new(Full::new(body.into()).map_err(|never| match never {}).boxed());
    *res.status_mut() = status;
    if let Ok(v) = content_type.parse() {
        res.headers_mut().insert("content-type", v);
    }
    res
}

/// `id` JSON-RPC požadavku (u dávky a notifikace null).
fn request_id(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .unwrap_or(serde_json::Value::Null)
}

/// Chyba JSON-RPC pro model, se stavem 200 (viz hlavička modulu).
fn rpc_error(body: &[u8], code: i64, message: &str) -> Response<Body> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id(body),
        "error": { "code": code, "message": message },
    });
    full(StatusCode::OK, "application/json", payload.to_string())
}

const SIGN_IN_MESSAGE: &str = "Stavebák: tento nástroj vyžaduje přihlášení a aplikace teď přihlášená není \
(přihlášení chybí nebo vypršelo). Požádejte uživatele, ať se přihlásí v aplikaci Stavebák v Nastavení, \
část Účet, tlačítko Přihlásit, a pak akci zopakujte. Konverzaci není potřeba restartovat. \
Příkaz /mcp ani nastavení konektorů v aplikaci Stavebák nejsou, nenabízejte je.";

fn unavailable_message(detail: &str) -> String {
    format!(
        "Stavebák: přihlášení teď nejde obnovit, server nebo síť nejsou dostupné ({}). \
Uživatel zůstává přihlášený. Zkuste akci za chvíli znovu.",
        detail.chars().take(160).collect::<String>()
    )
}

async fn handle(shared: Arc<Shared>, req: Request<Incoming>) -> Result<Response<Body>, Infallible> {
    if let Err((status, msg)) = check_request(&req, &shared.key, shared.port) {
        return Ok(full(status, "text/plain; charset=utf-8", msg));
    }
    let (parts, body) = req.into_parts();
    let body = match Limited::new(body, MAX_REQUEST_BYTES).collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => return Ok(full(StatusCode::PAYLOAD_TOO_LARGE, "text/plain; charset=utf-8", "Požadavek je příliš velký.")),
    };
    Ok(forward(&shared.cfg, &parts, body).await)
}

async fn forward(cfg: &Config, parts: &hyper::http::request::Parts, body: Bytes) -> Response<Body> {
    let client = (cfg.client)().await;
    let send = |token: Option<String>| {
        let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST);
        let mut rb = client.request(method, &cfg.upstream).body(body.clone());
        for name in FORWARD_REQUEST_HEADERS {
            if let Some(v) = parts.headers.get(*name).and_then(|v| v.to_str().ok()) {
                rb = rb.header(*name, v);
            }
        }
        if let Some(t) = token {
            rb = rb.bearer_auth(t);
        }
        rb.send()
    };

    let mut state = cfg.tokens.current().await;
    let mut sent = valid(&state);
    let mut res = match send(sent.clone()).await {
        Ok(r) => r,
        Err(e) => return rpc_error(&body, -32603, &format!("Stavebák: server není dostupný ({}). Zkuste akci znovu.", e)),
    };

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rejected) = sent.take() {
            state = cfg.tokens.after_rejection(&rejected).await;
            sent = valid(&state);
            if sent.is_some() {
                res = match send(sent.clone()).await {
                    Ok(r) => r,
                    Err(e) => return rpc_error(&body, -32603, &format!("Stavebák: server není dostupný ({}). Zkuste akci znovu.", e)),
                };
            }
        }
    }

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return match state {
            TokenState::Unavailable(detail) => rpc_error(&body, -32001, &unavailable_message(&detail)),
            _ => {
                (cfg.on_auth_required)();
                rpc_error(&body, -32001, SIGN_IN_MESSAGE)
            }
        };
    }
    stream_response(res)
}

fn valid(state: &TokenState) -> Option<String> {
    match state {
        TokenState::Valid(t) => Some(t.clone()),
        _ => None,
    }
}

/// Odpověď serveru proudem (SSE i JSON), bez čekání na celé tělo.
fn stream_response(res: reqwest::Response) -> Response<Body> {
    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers: Vec<(&'static str, hyper::header::HeaderValue)> = FORWARD_RESPONSE_HEADERS
        .iter()
        .filter_map(|name| {
            let v = res.headers().get(*name)?;
            Some((*name, hyper::header::HeaderValue::from_bytes(v.as_bytes()).ok()?))
        })
        .collect();
    let stream = res
        .bytes_stream()
        .map(|chunk| chunk.map(Frame::data).map_err(std::io::Error::other));
    let mut out = Response::new(BodyExt::boxed(StreamBody::new(stream)));
    *out.status_mut() = status;
    for (name, value) in headers {
        out.headers_mut().insert(name, value);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    /// Náhrada stavebak_auth: aktuální stav a co vrátit po odmítnutí.
    struct FakeTokens {
        current: Mutex<TokenState>,
        after: TokenState,
        rejections: AtomicUsize,
    }

    impl TokenSource for FakeTokens {
        fn current(&self) -> TokenFuture<'_> {
            let s = self.current.lock().unwrap().clone();
            Box::pin(async move { s })
        }
        fn after_rejection<'a>(&'a self, _rejected: &'a str) -> TokenFuture<'a> {
            self.rejections.fetch_add(1, Ordering::SeqCst);
            *self.current.lock().unwrap() = self.after.clone();
            let s = self.after.clone();
            Box::pin(async move { s })
        }
    }

    /// Falešný MCP server: token "good" projde (odpověď jako SSE), jiný nebo žádný dostane 401.
    async fn fake_upstream(seen: Arc<Mutex<Vec<Option<String>>>>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let seen = seen.clone();
                tokio::spawn(async move {
                    let svc = hyper::service::service_fn(move |req: Request<Incoming>| {
                        let seen = seen.clone();
                        async move {
                            let auth = req.headers().get("authorization").map(|v| v.to_str().unwrap().to_string());
                            assert!(req.headers().get(KEY_HEADER).is_none(), "klíč mostu nesmí ke serveru");
                            seen.lock().unwrap().push(auth.clone());
                            let res = if auth.as_deref() == Some("Bearer good") {
                                let mut r = full(StatusCode::OK, "text/event-stream", "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{}}\n\n");
                                r.headers_mut().insert("www-authenticate", "x".parse().unwrap());
                                r
                            } else {
                                let mut r = full(StatusCode::UNAUTHORIZED, "application/json", "{\"error\":\"invalid_token\"}");
                                r.headers_mut().insert("www-authenticate", "Bearer resource_metadata=\"x\"".parse().unwrap());
                                r
                            };
                            Ok::<_, Infallible>(res)
                        }
                    });
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(hyper_util::rt::TokioIo::new(stream), svc)
                        .await;
                });
            }
        });
        format!("http://127.0.0.1:{}/mcp", port)
    }

    async fn bridge_with(
        upstream: String,
        current: TokenState,
        after: TokenState,
    ) -> (Bridge, Arc<FakeTokens>, Arc<AtomicUsize>) {
        let tokens = Arc::new(FakeTokens { current: Mutex::new(current), after, rejections: AtomicUsize::new(0) });
        let prompts = Arc::new(AtomicUsize::new(0));
        let p = prompts.clone();
        let bridge = start(Config {
            upstream,
            tokens: tokens.clone(),
            client: Box::new(|| Box::pin(async { reqwest::Client::builder().no_proxy().build().unwrap() })),
            on_auth_required: Box::new(move || {
                p.fetch_add(1, Ordering::SeqCst);
            }),
        })
        .await
        .unwrap();
        (bridge, tokens, prompts)
    }

    fn call(bridge: &Bridge) -> reqwest::RequestBuilder {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(&bridge.url)
            .header(KEY_HEADER, &bridge.key)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"guide","arguments":{}}}"#)
    }

    #[tokio::test]
    async fn forwards_valid_token_and_streams_response() {
        let seen = Arc::new(Mutex::new(vec![]));
        let up = fake_upstream(seen.clone()).await;
        let (bridge, tokens, _) = bridge_with(up, TokenState::Valid("good".into()), TokenState::SignedOut).await;
        let res = call(&bridge).send().await.unwrap();
        assert_eq!(res.status(), 200);
        assert!(res.headers().get("www-authenticate").is_none());
        assert_eq!(res.headers()["content-type"], "text/event-stream");
        assert!(res.text().await.unwrap().contains("\"id\":7"));
        assert_eq!(*seen.lock().unwrap(), vec![Some("Bearer good".to_string())]);
        assert_eq!(tokens.rejections.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn rejected_token_is_refreshed_and_retried_once() {
        let seen = Arc::new(Mutex::new(vec![]));
        let up = fake_upstream(seen.clone()).await;
        let (bridge, tokens, prompts) =
            bridge_with(up, TokenState::Valid("expired".into()), TokenState::Valid("good".into())).await;
        let res = call(&bridge).send().await.unwrap();
        assert_eq!(res.status(), 200);
        assert!(res.text().await.unwrap().contains("result"));
        assert_eq!(
            *seen.lock().unwrap(),
            vec![Some("Bearer expired".to_string()), Some("Bearer good".to_string())]
        );
        assert_eq!(tokens.rejections.load(Ordering::SeqCst), 1);
        assert_eq!(prompts.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn signed_out_gets_rpc_error_not_http_401() {
        let seen = Arc::new(Mutex::new(vec![]));
        let up = fake_upstream(seen.clone()).await;
        let (bridge, _, prompts) =
            bridge_with(up, TokenState::Valid("revoked".into()), TokenState::SignedOut).await;
        let res = call(&bridge).send().await.unwrap();
        assert_eq!(res.status(), 200);
        assert!(res.headers().get("www-authenticate").is_none());
        let v: serde_json::Value = res.json().await.unwrap();
        assert_eq!(v["id"], 7);
        assert_eq!(v["error"]["code"], -32001);
        assert!(v["error"]["message"].as_str().unwrap().contains("Přihlásit"));
        assert_eq!(prompts.load(Ordering::SeqCst), 1);
        // Bez platného tokenu se podruhé neposílá
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn refresh_outage_keeps_sign_in_and_says_so() {
        let seen = Arc::new(Mutex::new(vec![]));
        let up = fake_upstream(seen).await;
        let (bridge, _, prompts) = bridge_with(
            up,
            TokenState::Unavailable("timeout".into()),
            TokenState::Unavailable("timeout".into()),
        )
        .await;
        let v: serde_json::Value = call(&bridge).send().await.unwrap().json().await.unwrap();
        assert!(v["error"]["message"].as_str().unwrap().contains("zůstává přihlášený"));
        assert_eq!(prompts.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn upstream_down_is_rpc_error() {
        let (bridge, _, _) =
            bridge_with("http://127.0.0.1:9/mcp".into(), TokenState::Valid("good".into()), TokenState::SignedOut).await;
        let v: serde_json::Value = call(&bridge).send().await.unwrap().json().await.unwrap();
        assert_eq!(v["error"]["code"], -32603);
    }

    #[tokio::test]
    async fn rejects_requests_without_key_or_from_browser() {
        let seen = Arc::new(Mutex::new(vec![]));
        let up = fake_upstream(seen.clone()).await;
        let (bridge, _, _) = bridge_with(up, TokenState::Valid("good".into()), TokenState::SignedOut).await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let no_key = client.post(&bridge.url).body("{}").send().await.unwrap();
        assert_eq!(no_key.status(), 403);
        let wrong_key = client.post(&bridge.url).header(KEY_HEADER, "x").body("{}").send().await.unwrap();
        assert_eq!(wrong_key.status(), 403);
        let browser = call(&bridge).header("origin", "https://evil.example").send().await.unwrap();
        assert_eq!(browser.status(), 403);
        let other_path = client
            .post(bridge.url.replace("/mcp", "/jinam"))
            .header(KEY_HEADER, &bridge.key)
            .send()
            .await
            .unwrap();
        assert_eq!(other_path.status(), 404);
        assert!(seen.lock().unwrap().is_empty(), "nic z toho nesmí k serveru");
    }

    #[test]
    fn host_must_be_loopback_with_our_port() {
        let req = |host: &str| {
            Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", host)
                .header(KEY_HEADER, "k")
                .body(())
                .unwrap()
        };
        assert!(check_request(&req("127.0.0.1:4000"), "k", 4000).is_ok());
        assert!(check_request(&req("localhost:4000"), "k", 4000).is_ok());
        assert!(check_request(&req("evil.example:4000"), "k", 4000).is_err());
        assert!(check_request(&req("127.0.0.1:4001"), "k", 4000).is_err());
    }
}
