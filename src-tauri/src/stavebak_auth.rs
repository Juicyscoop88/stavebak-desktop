//! Přihlášení ke Stavebáku (spec 096 část 3 v repu serveru). Aplikace je běžný MCP OAuth klient:
//! discovery, dynamická registrace, PKCE, návrat přes loopback `http://127.0.0.1:<port>/callback`.
//! Tokeny jsou v klíčence systému, klíčem je origin MCP serveru (lokální a produkční účet se nepletou).
//! Model (session Claude Code i Codex) jde přes most `mcp_bridge`, panely UI přes `mcp_rpc`; oba berou
//! token odsud, takže jdou pod stejným účtem. Bez přihlášení vše funguje dál anonymně.
//!
//! Obnova: přístupový token platí krátce (server: hodina), refresh token rotuje a starý po použití
//! přestane platit. Proto obnovuje vždy jen jeden požadavek najednou (`REFRESH_LOCK`) a ostatní
//! po něm převezmou nový token. Odhlásí se jen tehdy, když server refresh token odmítne
//! (`invalid_grant`), ne při výpadku sítě.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const KEYRING_SERVICE: &str = "cz.stavebak.desktop";
/// Token obnovit, když do vypršení zbývá méně (sekundy).
const REFRESH_MARGIN_SECS: u64 = 300;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize, Clone)]
struct StoredTokens {
    access_token: String,
    refresh_token: Option<String>,
    /// Unix sekundy
    expires_at: u64,
    client_id: String,
    token_endpoint: String,
}

#[derive(Deserialize)]
struct Metadata {
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `https://stavebak.cz/mcp` → `https://stavebak.cz`
pub fn origin(mcp_url: &str) -> Result<String, String> {
    let (scheme, rest) = mcp_url.split_once("://").ok_or("Neplatná adresa serveru")?;
    let host = rest.split('/').next().unwrap_or(rest);
    Ok(format!("{}://{}", scheme, host))
}

fn entry(mcp_url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &origin(mcp_url)?).map_err(|e| e.to_string())
}

fn load(mcp_url: &str) -> Option<StoredTokens> {
    let json = entry(mcp_url).ok()?.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

fn save(mcp_url: &str, tokens: &StoredTokens) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    entry(mcp_url)?.set_password(&json).map_err(|e| format!("Klíčenka: {}", e))
}

/// Pro e2e test mostu: nasimuluje odvolaný nebo vypršelý přístupový token.
#[cfg(test)]
pub(crate) fn set_access_for_test(mcp_url: &str, access_token: &str, expires_at: u64) {
    let mut t = load(mcp_url).expect("přihlášen");
    t.access_token = access_token.to_string();
    t.expires_at = expires_at;
    save(mcp_url, &t).unwrap();
}

#[cfg(test)]
pub(crate) fn stored_access_for_test(mcp_url: &str) -> Option<String> {
    load(mcp_url).map(|t| t.access_token)
}

pub fn logout(mcp_url: &str) -> Result<(), String> {
    match entry(mcp_url)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn is_signed_in(mcp_url: &str) -> bool {
    load(mcp_url).is_some()
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

async fn token_request(endpoint: &str, form: &[(&str, &str)]) -> Result<TokenResponse, TokenError> {
    let res = http()
        .post(endpoint)
        .form(form)
        .send()
        .await
        .map_err(|e| TokenError::Unavailable(format!("Server není dostupný: {}", e)))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| TokenError::Unavailable(e.to_string()))?;
    if !status.is_success() {
        return Err(classify_token_error(status.as_u16(), &body));
    }
    serde_json::from_str(&body).map_err(|e| TokenError::Unavailable(e.to_string()))
}

/// Chyba výměny tokenu: server přihlášení odmítl (trvalé), nebo nebyl dostupný (přechodné).
#[derive(Debug)]
enum TokenError {
    Rejected(String),
    Unavailable(String),
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenError::Rejected(m) | TokenError::Unavailable(m) => f.write_str(m),
        }
    }
}

/// Podle RFC 6749 §5.2: 400/401 s `invalid_grant`, `invalid_client` nebo `unauthorized_client` znamená,
/// že refresh token (nebo registrace aplikace) už neplatí. Cokoli jiného (5xx, 429, síť) je přechodné.
fn classify_token_error(status: u16, body: &str) -> TokenError {
    let code = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string));
    let msg = format!("Přihlášení se nezdařilo ({}): {}", status, body.chars().take(200).collect::<String>());
    let rejected = matches!(status, 400 | 401)
        && matches!(code.as_deref(), Some("invalid_grant" | "invalid_client" | "unauthorized_client"));
    if rejected {
        TokenError::Rejected(msg)
    } else {
        TokenError::Unavailable(msg)
    }
}

fn to_stored(t: TokenResponse, client_id: &str, token_endpoint: &str, prev_refresh: Option<String>) -> StoredTokens {
    StoredTokens {
        access_token: t.access_token,
        // Server refresh token rotuje; když nový nepřijde, zůstává starý
        refresh_token: t.refresh_token.or(prev_refresh),
        expires_at: now() + t.expires_in.unwrap_or(3600),
        client_id: client_id.to_string(),
        token_endpoint: token_endpoint.to_string(),
    }
}

/// Stav přihlášení pro jeden požadavek.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenState {
    Valid(String),
    /// Nepřihlášen, nebo server přihlášení odmítl (tokeny jsou smazané).
    SignedOut,
    /// Token vypršel a obnovit ho teď nejde (síť, výpadek serveru). Přihlášení zůstává.
    Unavailable(String),
}

/// Jen jedna obnova najednou v celé aplikaci: refresh token rotuje, dvě souběžné obnovy
/// by tu druhou odmítly a uživatel by se odhlásil.
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Zavolá se, když server přihlášení odmítne a aplikace uživatele odhlásí (UI to má ukázat).
static ON_SIGNED_OUT: std::sync::OnceLock<Box<dyn Fn() + Send + Sync>> = std::sync::OnceLock::new();

pub fn set_on_signed_out(f: impl Fn() + Send + Sync + 'static) {
    let _ = ON_SIGNED_OUT.set(Box::new(f));
}

/// Platný přístupový token, případně obnovený. `None` = nepřihlášen nebo teď nedostupný.
pub async fn access_token(mcp_url: &str) -> Option<String> {
    match token(mcp_url).await {
        TokenState::Valid(t) => Some(t),
        _ => None,
    }
}

/// Token pro požadavek: platný vrátí hned, krátce před vypršením ho obnoví.
pub async fn token(mcp_url: &str) -> TokenState {
    match load(mcp_url) {
        None => return TokenState::SignedOut,
        Some(t) if t.expires_at > now() + REFRESH_MARGIN_SECS => return TokenState::Valid(t.access_token),
        Some(_) => {}
    }
    let _guard = REFRESH_LOCK.lock().await;
    // Mezitím mohl obnovit jiný požadavek
    match load(mcp_url) {
        None => TokenState::SignedOut,
        Some(t) if t.expires_at > now() + REFRESH_MARGIN_SECS => TokenState::Valid(t.access_token),
        Some(t) => refresh_locked(mcp_url, t).await,
    }
}

/// Server odmítl `rejected` (401), i když podle hodin ještě platil (odvolán, restart serveru, posun hodin).
/// Když už mezitím přišel jiný token, vrátí ten, jinak obnoví.
pub async fn token_after_rejection(mcp_url: &str, rejected: &str) -> TokenState {
    let _guard = REFRESH_LOCK.lock().await;
    match load(mcp_url) {
        None => TokenState::SignedOut,
        Some(t) if t.access_token != rejected => TokenState::Valid(t.access_token),
        Some(t) => refresh_locked(mcp_url, t).await,
    }
}

/// Volat jen pod `REFRESH_LOCK`.
async fn refresh_locked(mcp_url: &str, tokens: StoredTokens) -> TokenState {
    let Some(refresh) = tokens.refresh_token.clone() else {
        sign_out(mcp_url, "chybí refresh token");
        return TokenState::SignedOut;
    };
    let res = token_request(
        &tokens.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh),
            ("client_id", &tokens.client_id),
            ("resource", mcp_url),
        ],
    )
    .await;
    match res {
        Ok(t) => {
            let stored = to_stored(t, &tokens.client_id, &tokens.token_endpoint, Some(refresh));
            if let Err(e) = save(mcp_url, &stored) {
                // Nový refresh token se neuložil a starý už neplatí: příští obnova selže a odhlásí
                eprintln!("[Stavebak] nový token nejde uložit do klíčenky: {}", e);
            }
            TokenState::Valid(stored.access_token)
        }
        Err(TokenError::Rejected(e)) => {
            sign_out(mcp_url, &e);
            TokenState::SignedOut
        }
        Err(TokenError::Unavailable(e)) => {
            eprintln!("[Stavebak] obnova tokenu teď nejde, zkusím znovu: {}", e);
            TokenState::Unavailable(e)
        }
    }
}

fn sign_out(mcp_url: &str, reason: &str) {
    eprintln!("[Stavebak] server přihlášení odmítl, odhlašuji: {}", reason);
    let _ = logout(mcp_url);
    if let Some(f) = ON_SIGNED_OUT.get() {
        f();
    }
}

const DONE_PAGE: &str = "<!doctype html><html lang=\"cs\"><meta charset=\"utf-8\"><title>Stavebák</title>\
<body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh;color:#1d1c1a;background:#f5f3ee\">\
<div style=\"text-align:center\"><h1 style=\"font-size:20px\">Přihlášení dokončeno</h1>\
<p>Můžete zavřít toto okno a vrátit se do aplikace Stavebák.</p></div></body></html>";

/// Počká na jedno přesměrování z prohlížeče na loopback a vrátí jeho query parametry.
async fn wait_for_callback(listener: tokio::net::TcpListener) -> Result<Vec<(String, String)>, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = sock.read(&mut buf).await.map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let target = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
        // Prohlížeč může zkusit i /favicon.ico, to ignorujeme
        if !target.starts_with("/callback") {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
        let params: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            DONE_PAGE.len(),
            DONE_PAGE
        );
        let _ = sock.write_all(resp.as_bytes()).await;
        return Ok(params);
    }
}

/// Celé přihlášení: otevře prohlížeč, počká na návrat a uloží tokeny. Vrací chybu česky.
pub async fn login(mcp_url: &str, open_browser: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
    let base = origin(mcp_url)?;
    let meta: Metadata = http()
        .get(format!("{}/.well-known/oauth-authorization-server", base))
        .send()
        .await
        .map_err(|e| format!("Server není dostupný: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Server nepodporuje přihlášení: {}", e))?;
    let registration = meta.registration_endpoint.ok_or("Server nepodporuje registraci aplikace")?;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    #[derive(Deserialize)]
    struct Registered {
        client_id: String,
    }
    let client: Registered = http()
        .post(&registration)
        .json(&serde_json::json!({
            "client_name": "Stavebak Desktop",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }))
        .send()
        .await
        .map_err(|e| format!("Registrace aplikace selhala: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Registrace aplikace selhala: {}", e))?;

    let verifier = random_b64(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_b64(16);
    let auth_url = format!(
        "{}?{}",
        meta.authorization_endpoint,
        url::form_urlencoded::Serializer::new(String::new())
            .append_pair("response_type", "code")
            .append_pair("client_id", &client.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("resource", mcp_url)
            .finish()
    );
    open_browser(&auth_url)?;

    let params = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_callback(listener))
        .await
        .map_err(|_| "Přihlášení vypršelo, zkuste to znovu.".to_string())??;
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    if let Some(err) = get("error") {
        return Err(format!("Přihlášení zrušeno ({})", err));
    }
    if get("state").as_deref() != Some(state.as_str()) {
        return Err("Přihlášení se nepodařilo ověřit (state), zkuste to znovu.".to_string());
    }
    let code = get("code").ok_or("Server nevrátil kód přihlášení")?;

    let tokens = token_request(
        &meta.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &client.client_id),
            ("code_verifier", &verifier),
            ("resource", mcp_url),
        ],
    )
    .await
    .map_err(|e| e.to_string())?;
    save(mcp_url, &to_stored(tokens, &client.client_id, &meta.token_endpoint, None))
}

#[cfg(test)]
mod tests {
    use super::{classify_token_error, origin, TokenError};

    #[test]
    fn only_rejected_grant_signs_out() {
        let rejected = |status, body| matches!(classify_token_error(status, body), TokenError::Rejected(_));
        assert!(rejected(400, r#"{"error":"invalid_grant","error_description":"Neplatný refresh token."}"#));
        assert!(rejected(401, r#"{"error":"invalid_client"}"#));
        // Výpadek, limit nebo nečitelná odpověď přihlášení nemaže
        assert!(!rejected(500, r#"{"error":"server_error"}"#));
        assert!(!rejected(503, "Service Unavailable"));
        assert!(!rejected(429, r#"{"error":"invalid_grant"}"#));
        assert!(!rejected(400, "<html>proxy</html>"));
    }

    #[test]
    fn origin_strips_path() {
        assert_eq!(origin("https://stavebak.cz/mcp").unwrap(), "https://stavebak.cz");
        assert_eq!(origin("http://localhost:3535/mcp").unwrap(), "http://localhost:3535");
        assert!(origin("stavebak.cz").is_err());
    }
}

/// Proti lokálnímu serveru s OAUTH_DEV_LOGIN=1: `cargo test --lib -- --ignored login_against_local_dev_server`.
/// „Prohlížeč“ nahradí HTTP klient, který projde přesměrování až na loopback.
#[cfg(test)]
mod local_server {
    #[tokio::test]
    #[ignore]
    async fn login_against_local_dev_server() {
        let url = "http://localhost:3535/mcp";
        let _ = super::logout(url);
        super::login(url, |auth_url| {
            let auth_url = auth_url.to_string();
            tokio::spawn(async move { let _ = reqwest::get(auth_url).await; });
            Ok(())
        })
        .await
        .expect("login");
        assert!(super::is_signed_in(url));
        let token = super::access_token(url).await.expect("token");
        let res = reqwest::Client::new()
            .post(url)
            .bearer_auth(token)
            .header("Accept", "application/json, text/event-stream")
            .json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account_status","arguments":{}}}))
            .send().await.unwrap().text().await.unwrap();
        assert!(res.contains("\\\"plan\\\""), "{}", res);
        println!("account_status: {}", &res[..res.len().min(300)]);
        super::logout(url).unwrap();
        assert!(!super::is_signed_in(url));
    }
}
