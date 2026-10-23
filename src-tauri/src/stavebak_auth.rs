//! Přihlášení ke Stavebáku (spec 096 část 3 v repu serveru). Aplikace je běžný MCP OAuth klient:
//! discovery, dynamická registrace, PKCE, návrat přes loopback `http://127.0.0.1:<port>/callback`.
//! Tokeny jsou v klíčence systému, klíčem je origin MCP serveru (lokální a produkční účet se nepletou).
//! Model (session Claude Code) i panely UI posílají stejný token, takže jdou pod stejným účtem.
//! Bez přihlášení vše funguje dál anonymně.

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

async fn token_request(endpoint: &str, form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = http().post(endpoint).form(form).send().await.map_err(|e| format!("Server není dostupný: {}", e))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Přihlášení se nezdařilo ({}): {}", status.as_u16(), body.chars().take(200).collect::<String>()));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
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

/// Platný přístupový token, případně obnovený. `None` = nepřihlášen (nebo obnova selhala, pak se odhlásí).
pub async fn access_token(mcp_url: &str) -> Option<String> {
    let tokens = load(mcp_url)?;
    if tokens.expires_at > now() + REFRESH_MARGIN_SECS {
        return Some(tokens.access_token);
    }
    let refresh = tokens.refresh_token.clone()?;
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
            let token = stored.access_token.clone();
            let _ = save(mcp_url, &stored);
            Some(token)
        }
        Err(e) => {
            eprintln!("[Stavebak] obnova tokenu selhala, odhlašuji: {}", e);
            let _ = logout(mcp_url);
            None
        }
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
    .await?;
    save(mcp_url, &to_stored(tokens, &client.client_id, &meta.token_endpoint, None))
}

#[cfg(test)]
mod tests {
    use super::origin;

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
