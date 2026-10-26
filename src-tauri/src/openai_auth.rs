//! Přihlášení k OpenAI pro Codex (docs/spec-codex-provider.md).
//!
//! - **Sign in with ChatGPT (SIWC)**, open-source cesta: uživatel v prohlížeči potvrdí použití
//!   svého plánu ChatGPT, aplikace dostane token a předá ho `codex-app-server` jako `ACCESS_TOKEN`.
//!   Postup podle developers.openai.com/siwc/token-sharing-open-source/sign-in, kód je vlastní
//!   (licence SIWC DevKitu je nekomerční, jeho kód nepoužíváme).
//! - **API klíč OpenAI**, který uživatel zadá v aplikaci.
//!
//! Podmínky (Sign in with ChatGPT Terms): jméno aplikace „Stavebak Desktop“, tokeny jen
//! v klíčence systému, nikdy do logu ani na server Stavebáku, při odhlášení odvolat.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const KEYRING_SERVICE: &str = "cz.stavebak.desktop";
const KEY_CHATGPT: &str = "openai:chatgpt-plan";
const KEY_API_KEY: &str = "openai:api-key";

const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const OPENID_CONFIG_URL: &str = "https://auth.openai.com/.well-known/openid-configuration";
const RESOURCE: &str = "https://api.openai.com/v1";
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CALLBACK_PATH: &str = "/auth/callback";

/// Access token platí hodinu; obnovit s rezervou.
const REFRESH_MARGIN_SECS: u64 = 300;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// Přihlášení přes ChatGPT je zapnuté v debug buildu. V release až po rozhodnutí o vydání
/// (dotaz na OpenAI), do té doby jen s `STAVEBAK_SIWC=1`.
pub fn siwc_enabled() -> bool {
    cfg!(debug_assertions) || std::env::var("STAVEBAK_SIWC").as_deref() == Ok("1")
}

#[derive(Serialize, Deserialize, Clone)]
struct StoredTokens {
    access_token: String,
    refresh_token: String,
    /// Unix sekundy
    expires_at: u64,
    /// Vydané `oaiapp_…` (nikdy `dynamic_agent_client`)
    client_id: String,
    email: Option<String>,
    plan: Option<String>,
}

/// Registrace aplikace u OpenAI: neveřejné, ale ne tajné údaje. Přežijí odhlášení,
/// aby se při dalším přihlášení klient znovu neregistroval.
#[derive(Serialize, Deserialize, Clone, Default)]
struct Registration {
    /// `urn:uuid:…`, zvolené před prvním přihlášením a pak stálé
    host_id: String,
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct OpenAiAuthStatus {
    /// Přihlášení přes ChatGPT je v tomto buildu dostupné
    pub siwc_available: bool,
    pub chatgpt_signed_in: bool,
    pub chatgpt_email: Option<String>,
    pub chatgpt_plan: Option<String>,
    pub api_key_set: bool,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

fn load_tokens() -> Option<StoredTokens> {
    serde_json::from_str(&entry(KEY_CHATGPT).ok()?.get_password().ok()?).ok()
}

fn save_tokens(t: &StoredTokens) -> Result<(), String> {
    let json = serde_json::to_string(t).map_err(|e| e.to_string())?;
    entry(KEY_CHATGPT)?.set_password(&json).map_err(|e| format!("Klíčenka: {}", e))
}

fn delete(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn registration_path() -> Option<std::path::PathBuf> {
    Some(dirs::home_dir()?.join(".stavebak").join("openai-registration.json"))
}

fn load_registration() -> Registration {
    let mut reg: Registration = registration_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if reg.host_id.is_empty() {
        reg.host_id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        save_registration(&reg);
    }
    reg
}

fn save_registration(reg: &Registration) {
    if let Some(p) = registration_path() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(reg) {
            let _ = std::fs::write(p, json);
        }
    }
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

async fn token_request(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = http()
        .post(TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|e| format!("OpenAI není dostupné: {}", e))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // Tělo chyby neobsahuje tokeny, jen kód a popis
        return Err(format!(
            "Přihlášení k ChatGPT se nezdařilo ({}): {}",
            status.as_u16(),
            body.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Nároky z ID tokenu. Podpis neověřujeme: token přišel přímo z token endpointu přes TLS
/// (OpenID Connect Core 3.1.3.7 bod 6), kontrolujeme vydavatele, příjemce, platnost a nonce.
#[derive(Debug, PartialEq)]
struct IdClaims {
    email: Option<String>,
    plan: Option<String>,
}

fn check_id_token(id_token: &str, client_id: &str, nonce: Option<&str>) -> Result<IdClaims, String> {
    let payload = id_token.split('.').nth(1).ok_or("Neplatný ID token")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| "Neplatný ID token")?;
    let c: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "Neplatný ID token")?;
    let iss = c["iss"].as_str().unwrap_or_default().trim_end_matches('/');
    if iss != ISSUER {
        return Err("ID token od neznámého vydavatele".into());
    }
    let aud_ok = match &c["aud"] {
        serde_json::Value::String(a) => a == client_id,
        serde_json::Value::Array(a) => a.iter().any(|x| x.as_str() == Some(client_id)),
        _ => false,
    };
    if !aud_ok {
        return Err("ID token není pro tuto aplikaci".into());
    }
    if c["exp"].as_u64().unwrap_or(0) <= now() {
        return Err("ID token vypršel".into());
    }
    if let Some(n) = nonce {
        if c["nonce"].as_str() != Some(n) {
            return Err("ID token neodpovídá přihlášení (nonce)".into());
        }
    }
    let auth = &c["https://api.openai.com/auth"];
    Ok(IdClaims {
        email: c["email"].as_str().map(String::from),
        plan: auth["chatgpt_plan_type"].as_str().map(String::from),
    })
}

fn has_plan_scope(scope: Option<&str>) -> bool {
    scope.map(|s| s.split_whitespace().any(|x| x == PLAN_SCOPE)).unwrap_or(false)
}

/// Obnova tokenu běží vždy jen jednou naráz (refresh token rotuje).
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Platný access token plánu ChatGPT, případně obnovený. `None` = nepřihlášeno.
pub async fn chatgpt_access_token() -> Option<String> {
    if !siwc_enabled() {
        return None;
    }
    let _guard = REFRESH_LOCK.lock().await;
    let tokens = load_tokens()?;
    if tokens.expires_at > now() + REFRESH_MARGIN_SECS {
        return Some(tokens.access_token);
    }
    // Bez `scope`: zachová se původní grant
    let res = token_request(&[
        ("grant_type", "refresh_token"),
        ("client_id", &tokens.client_id),
        ("refresh_token", &tokens.refresh_token),
        ("resource", RESOURCE),
    ])
    .await;
    match res {
        Ok(t) => {
            let stored = StoredTokens {
                access_token: t.access_token,
                refresh_token: t.refresh_token.unwrap_or(tokens.refresh_token),
                expires_at: now() + t.expires_in.unwrap_or(3600),
                client_id: tokens.client_id,
                email: tokens.email,
                plan: tokens.plan,
            };
            let token = stored.access_token.clone();
            let _ = save_tokens(&stored);
            Some(token)
        }
        Err(e) => {
            eprintln!("[Stavebak] obnova přihlášení k ChatGPT selhala, odhlašuji: {}", e);
            let _ = delete(KEY_CHATGPT);
            None
        }
    }
}

pub fn api_key() -> Option<String> {
    entry(KEY_API_KEY).ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

pub fn set_api_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if !key.starts_with("sk-") {
        return Err("To nevypadá jako API klíč OpenAI (začíná sk-).".into());
    }
    entry(KEY_API_KEY)?.set_password(key).map_err(|e| format!("Klíčenka: {}", e))
}

pub fn clear_api_key() -> Result<(), String> {
    delete(KEY_API_KEY)
}

pub fn status() -> OpenAiAuthStatus {
    let tokens = if siwc_enabled() { load_tokens() } else { None };
    OpenAiAuthStatus {
        siwc_available: siwc_enabled(),
        chatgpt_signed_in: tokens.is_some(),
        chatgpt_email: tokens.as_ref().and_then(|t| t.email.clone()),
        chatgpt_plan: tokens.as_ref().and_then(|t| t.plan.clone()),
        api_key_set: api_key().is_some(),
    }
}

/// Odhlášení: odvolat refresh token u OpenAI a smazat z klíčenky (smaže se i při chybě sítě).
pub async fn logout_chatgpt() -> Result<(), String> {
    if let Some(t) = load_tokens() {
        let revoke = async {
            let cfg: serde_json::Value = http().get(OPENID_CONFIG_URL).send().await.ok()?.json().await.ok()?;
            let endpoint = cfg["revocation_endpoint"].as_str()?.to_string();
            http()
                .post(endpoint)
                .form(&[
                    ("token", t.refresh_token.as_str()),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", t.client_id.as_str()),
                ])
                .send()
                .await
                .ok()
        };
        if revoke.await.is_none() {
            eprintln!("[Stavebak] odvolání tokenu ChatGPT se nepodařilo, mažu jen lokálně");
        }
    }
    delete(KEY_CHATGPT)
}

const DONE_PAGE: &str = "<!doctype html><html lang=\"cs\"><meta charset=\"utf-8\"><title>Stavebák</title>\
<body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh;color:#1d1c1a;background:#f5f3ee\">\
<div style=\"text-align:center\"><h1 style=\"font-size:20px\">Přihlášení k ChatGPT dokončeno</h1>\
<p>Můžete zavřít toto okno a vrátit se do aplikace Stavebák.</p></div></body></html>";

async fn wait_for_callback(listener: tokio::net::TcpListener) -> Result<Vec<(String, String)>, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = sock.read(&mut buf).await.map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let target = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        if path != CALLBACK_PATH {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
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

fn authorize_url(
    client_id: Option<&str>,
    host_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
    nonce: &str,
) -> String {
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    q.append_pair("response_type", "code")
        .append_pair("client_id", client_id.unwrap_or(DYNAMIC_CLIENT))
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("resource", RESOURCE)
        .append_pair("ext_agent_host_id", host_id)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("nonce", nonce);
    // Jméno aplikace jen při první (dynamické) registraci
    if client_id.is_none() {
        q.append_pair("agent_name_hint", crate::codex_bridge::CLIENT_NAME);
    }
    format!("{}?{}", AUTHORIZE_URL, q.finish())
}

/// Celé přihlášení přes ChatGPT: prohlížeč, návrat na loopback, výměna kódu, kontrola grantu.
pub async fn login_chatgpt(open_browser: impl FnOnce(&str) -> Result<(), String>) -> Result<OpenAiAuthStatus, String> {
    if !siwc_enabled() {
        return Err("Přihlášení přes ChatGPT zatím není v této verzi dostupné.".into());
    }
    let mut reg = load_registration();
    // Adresa musí být 127.0.0.1 (ne localhost) a cesta /auth/callback, měnit se smí jen port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}{}", port, CALLBACK_PATH);

    let verifier = random_b64(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_b64(16);
    let nonce = random_b64(16);
    let url = authorize_url(reg.client_id.as_deref(), &reg.host_id, &redirect_uri, &challenge, &state, &nonce);
    open_browser(&url)?;

    let params = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_callback(listener))
        .await
        .map_err(|_| "Přihlášení vypršelo, zkuste to znovu.".to_string())??;
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    if let Some(err) = get("error") {
        return Err(if err == "access_denied" {
            "Přihlášení k ChatGPT bylo zrušeno.".to_string()
        } else {
            format!("Přihlášení k ChatGPT se nezdařilo ({})", err)
        });
    }
    if get("state").as_deref() != Some(state.as_str()) {
        return Err("Přihlášení se nepodařilo ověřit (state), zkuste to znovu.".into());
    }
    let code = get("code").ok_or("OpenAI nevrátilo kód přihlášení")?;
    let client_id = match (get("client_id"), reg.client_id.clone()) {
        (Some(new), _) if new != DYNAMIC_CLIENT => new,
        (_, Some(existing)) => existing,
        _ => return Err("OpenAI nevydalo identifikátor aplikace, zkuste to znovu.".into()),
    };
    if reg.client_id.as_deref() != Some(client_id.as_str()) {
        reg.client_id = Some(client_id.clone());
        save_registration(&reg);
    }

    let t = token_request(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &code),
        ("code_verifier", &verifier),
        ("redirect_uri", &redirect_uri),
        ("resource", RESOURCE),
    ])
    .await?;
    let claims = match t.id_token.as_deref() {
        Some(id) => check_id_token(id, &client_id, Some(&nonce))?,
        None => IdClaims { email: None, plan: None },
    };
    // Platný ID token ještě neznamená souhlas s použitím plánu
    if !has_plan_scope(t.scope.as_deref()) {
        return Err("Použití plánu ChatGPT nebylo povoleno. Bez něj Codex v aplikaci nepoběží.".into());
    }
    let refresh_token = t.refresh_token.ok_or("OpenAI nevrátilo obnovovací token")?;
    save_tokens(&StoredTokens {
        access_token: t.access_token,
        refresh_token,
        expires_at: now() + t.expires_in.unwrap_or(3600),
        client_id,
        email: claims.email,
        plan: claims.plan,
    })?;
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(claims: serde_json::Value) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn prvni_prihlaseni_registruje_aplikaci_jmenem() {
        let u = authorize_url(None, "urn:uuid:1", "http://127.0.0.1:5000/auth/callback", "ch", "st", "no");
        let q: Vec<(String, String)> = url::Url::parse(&u).unwrap().query_pairs().into_owned().collect();
        let get = |k: &str| q.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert!(u.starts_with(AUTHORIZE_URL));
        assert_eq!(get("client_id"), Some("dynamic_agent_client"));
        assert_eq!(get("agent_name_hint"), Some("Stavebak Desktop"));
        assert_eq!(get("scope"), Some("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"));
        assert_eq!(get("resource"), Some("https://api.openai.com/v1"));
        assert_eq!(get("ext_agent_host_id"), Some("urn:uuid:1"));
        assert_eq!(get("code_challenge_method"), Some("S256"));
        assert_eq!(get("redirect_uri"), Some("http://127.0.0.1:5000/auth/callback"));
    }

    #[test]
    fn dalsi_prihlaseni_pouzije_vydane_id_bez_jmena() {
        let u = authorize_url(Some("oaiapp_123"), "urn:uuid:1", "http://127.0.0.1:5000/auth/callback", "ch", "st", "no");
        assert!(u.contains("client_id=oaiapp_123"));
        assert!(!u.contains("agent_name_hint"));
    }

    #[test]
    fn id_token_kontroly() {
        let ok = jwt(serde_json::json!({ "iss": "https://auth.openai.com", "aud": "oaiapp_1", "exp": now() + 600,
            "nonce": "n1", "email": "a@b.cz", "https://api.openai.com/auth": { "chatgpt_plan_type": "plus" } }));
        let c = check_id_token(&ok, "oaiapp_1", Some("n1")).unwrap();
        assert_eq!(c.email.as_deref(), Some("a@b.cz"));
        assert_eq!(c.plan.as_deref(), Some("plus"));
        assert!(check_id_token(&ok, "oaiapp_2", Some("n1")).is_err());
        assert!(check_id_token(&ok, "oaiapp_1", Some("jiny")).is_err());
        let old = jwt(serde_json::json!({ "iss": "https://auth.openai.com", "aud": "oaiapp_1", "exp": 1 }));
        assert!(check_id_token(&old, "oaiapp_1", None).is_err());
        let foreign = jwt(serde_json::json!({ "iss": "https://evil.example", "aud": "oaiapp_1", "exp": now() + 600 }));
        assert!(check_id_token(&foreign, "oaiapp_1", None).is_err());
    }

    #[test]
    fn grant_musi_obsahovat_plan() {
        assert!(has_plan_scope(Some("openid email chatgpt.tokens.use.direct")));
        assert!(!has_plan_scope(Some("openid email")));
        assert!(!has_plan_scope(None));
    }
}
