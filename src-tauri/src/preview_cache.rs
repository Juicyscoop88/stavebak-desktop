//! Cache převedených náhledů (DWG → DXF). Převod dál dělá server přes MCP nástroje
//! (`request_upload`, `convert_drawing`), tady se jen pamatuje výsledek, aby se stejný výkres
//! nepřeváděl při každém kliknutí. Klíčem je SHA-256 obsahu souboru, takže změněný výkres se
//! převede znovu. Data zůstávají v `~/.stavebak/cache/previews/` na počítači uživatele.

use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Změna formátu nebo převodu na serveru = nová verze, staré položky se přestanou používat.
const CACHE_VERSION: &str = "v1";
const MAX_FILES: usize = 200;
const MAX_BYTES: u64 = 500 * 1024 * 1024;

pub fn cache_dir() -> Option<PathBuf> {
    let dir = dirs::home_dir()?.join(".stavebak").join("cache").join("previews");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn safe_ext(to: &str) -> Option<&str> {
    (!to.is_empty() && to.len() <= 8 && to.chars().all(|c| c.is_ascii_alphanumeric())).then_some(to)
}

/// Klíč položky: otisk obsahu zdrojového souboru, cílový formát a verze cache.
pub fn key_for(source: &[u8], to: &str) -> Option<String> {
    let ext = safe_ext(to)?;
    let hash: String = Sha256::digest(source).iter().map(|b| format!("{:02x}", b)).collect();
    Some(format!("{hash}-{CACHE_VERSION}.{ext}"))
}

fn mime_for(to: &str) -> &'static str {
    match to {
        "dxf" => "application/dxf",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Data URL z cache, nebo `None`. Při zásahu se obnoví čas, aby úklid mazal nejstarší nepoužité.
pub fn get(dir: &Path, key: &str, to: &str) -> Option<String> {
    let path = dir.join(key);
    let bytes = std::fs::read(&path).ok()?;
    let _ = filetime_touch(&path);
    Some(format!(
        "data:{};base64,{}",
        mime_for(to),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Uloží výsledek převodu (data URL) a uklidí cache nad limity.
pub fn put(dir: &Path, key: &str, data_url: &str) -> Result<(), String> {
    let b64 = data_url
        .split_once(";base64,")
        .map(|(_, b)| b)
        .ok_or("Neplatná data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{key}.tmp"));
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(key)).map_err(|e| e.to_string())?;
    prune(dir, MAX_FILES, MAX_BYTES);
    Ok(())
}

fn filetime_touch(path: &Path) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().append(true).open(path)?;
    f.set_modified(std::time::SystemTime::now())
}

/// Smaže nejstarší položky, dokud cache nesplní počet i velikost.
fn prune(dir: &Path, max_files: usize, max_bytes: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<(PathBuf, std::time::SystemTime, u64)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file().then(|| (e.path(), m.modified().unwrap_or(std::time::UNIX_EPOCH), m.len()))
        })
        .collect();
    entries.sort_by_key(|(_, t, _)| *t);
    let mut total: u64 = entries.iter().map(|(_, _, s)| s).sum();
    let mut count = entries.len();
    for (path, _, size) in entries {
        if count <= max_files && total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            count -= 1;
            total = total.saturating_sub(size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("stavebak-preview-cache-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn stejny_obsah_stejny_klic_jiny_obsah_jiny() {
        let a = key_for(b"AC1015 vykres", "dxf").unwrap();
        assert_eq!(a, key_for(b"AC1015 vykres", "dxf").unwrap());
        assert_ne!(a, key_for(b"AC1015 vykres upraveny", "dxf").unwrap());
        assert!(a.ends_with("-v1.dxf"));
        assert!(key_for(b"x", "../etc").is_none());
    }

    #[test]
    fn ulozi_a_vrati_data_url() {
        let dir = tmp_dir("roundtrip");
        let key = key_for(b"dwg", "dxf").unwrap();
        assert!(get(&dir, &key, "dxf").is_none());
        let dxf = "0\nSECTION\n2\nHEADER\n";
        let url = format!("data:application/dxf;base64,{}", base64::engine::general_purpose::STANDARD.encode(dxf));
        put(&dir, &key, &url).unwrap();
        assert_eq!(get(&dir, &key, "dxf").unwrap(), url);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn uklid_smaze_nejstarsi() {
        let dir = tmp_dir("prune");
        for i in 0..5 {
            std::fs::write(dir.join(format!("{i}.dxf")), vec![0u8; 10]).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        prune(&dir, 3, u64::MAX);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        left.sort();
        assert_eq!(left, vec!["2.dxf", "3.dxf", "4.dxf"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
