//! Path access boundary for Tauri file commands.
//!
//! Phase 3 / Task C / v3 §3.1. Prior to this module, every file command in
//! `lib.rs` accepted arbitrary absolute paths — a malicious assistant that
//! emitted a markdown image referencing `/etc/passwd` could make the webview
//! read the host's password file via `read_file_base64`. This module introduces
//! a two-tier allowlist:
//!
//! 1. **Fixed roots** — paths that are always allowed (project cwd[s],
//!    `~/.claude.json`, `~/.claude/`, `~/.stavebak/`, system temp dir).
//! 2. **Session grants** — paths that the user has explicitly authorized at
//!    runtime (via the native file dialog, OS drag-drop, or a Markdown
//!    "authorize" button). Grants are scoped per stdin/tab id and cleared
//!    when the tab goes away.
//!
//! Credential stores of AI CLIs (Claude Code's `.credentials.json`, Codex's
//! `auth.json`) are refused regardless of roots or grants: the app never reads
//! or writes sign-in credentials.
//!
//! All paths are canonicalized before comparison to prevent `..` traversal.
//! When the filesystem cannot canonicalize a non-existing target (e.g. write
//! to a new file), the closest existing ancestor is canonicalized instead
//! and the remaining tail is re-joined on top.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;

/// Capability requested when validating a path.
///
/// Kept as a distinct type so callers must state intent; today it is not
/// used to change the allowlist but logging/metrics can branch on it later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathCapability {
    Read,
    Write,
    Delete,
}

#[derive(Debug, Default, Clone)]
pub struct PathAccessManager {
    fixed_roots: Arc<Mutex<Vec<PathBuf>>>,
    session_grants: Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
}

impl PathAccessManager {
    pub fn new() -> Self {
        let mut roots: Vec<PathBuf> = Vec::new();

        if let Some(home) = dirs::home_dir() {
            push_canonical(&mut roots, home.join(".claude.json"));
            push_canonical(&mut roots, home.join(".claude"));
            push_canonical(&mut roots, home.join(".stavebak"));
            push_canonical(
                &mut roots,
                home.join("Library/Application Support/Stavebak"),
            );
        }
        // System temp dir — save_temp_file writes here when cwd is missing.
        push_canonical(&mut roots, std::env::temp_dir());

        Self {
            fixed_roots: Arc::new(Mutex::new(roots)),
            session_grants: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Empty constructor for tests — no implicit roots at all.
    #[cfg(test)]
    pub fn empty() -> Self {
        Self {
            fixed_roots: Arc::new(Mutex::new(Vec::new())),
            session_grants: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a working directory (per-session cwd) as a fixed root for this
    /// app instance. Deduplication is cheap — we canonicalize on insert.
    pub async fn register_cwd(&self, cwd: &Path) {
        let mut roots = self.fixed_roots.lock().await;
        push_canonical(&mut roots, cwd.to_path_buf());
    }

    /// Add a path grant for the given tab/stdin id. The path is canonicalized
    /// first so symlinks don't break the comparison later.
    pub async fn add_grant(&self, tab_id: &str, path: &Path) {
        let canonical = canonicalize_best_effort(path);
        let mut grants = self.session_grants.lock().await;
        grants
            .entry(tab_id.to_string())
            .or_default()
            .insert(canonical);
    }

    /// Clear all grants for a tab. Called from `teardownSession` / tab close.
    pub async fn clear_grants(&self, tab_id: &str) {
        let mut grants = self.session_grants.lock().await;
        grants.remove(tab_id);
    }

    /// Check whether `path` is allowed. Returns the canonical path on success.
    /// When `tab_id` is `None`, only fixed roots and grants across ALL tabs
    /// are consulted (used by commands that don't have a tab context yet, e.g.
    /// the file tree scanner).
    pub async fn validate(
        &self,
        path: &Path,
        tab_id: Option<&str>,
        _cap: PathCapability,
    ) -> Result<PathBuf, String> {
        let canonical = canonicalize_best_effort(path);

        if is_credential_store(&canonical) {
            return Err(format!(
                "Path '{}' holds sign-in credentials and is never accessed by the app.",
                canonical.display()
            ));
        }

        let roots = self.fixed_roots.lock().await;
        if roots.iter().any(|root| path_starts_with(&canonical, root)) {
            return Ok(canonical);
        }
        drop(roots);

        let grants = self.session_grants.lock().await;
        if let Some(tid) = tab_id {
            if let Some(set) = grants.get(tid) {
                if set.iter().any(|g| path_starts_with(&canonical, g)) {
                    return Ok(canonical);
                }
            }
        } else {
            // No tab context — any tab's grant is acceptable (file tree scan etc.)
            for set in grants.values() {
                if set.iter().any(|g| path_starts_with(&canonical, g)) {
                    return Ok(canonical);
                }
            }
        }

        Err(format!(
            "Path '{}' is outside the allowed workspace. If this is a legitimate \
             external file, authorize it via the file dialog first.",
            canonical.display()
        ))
    }
}

/// Canonicalize aggressively, falling back to lexical normalization when the
/// target does not exist yet (e.g. `write_file_content` to a new path).
fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(c) = path.canonicalize() {
        return c;
    }
    // Walk up until we find an existing ancestor, canonicalize it, then re-join.
    let mut ancestors = path.ancestors().skip(1);
    for anc in ancestors.by_ref() {
        if let Ok(c) = anc.canonicalize() {
            let rel = path.strip_prefix(anc).unwrap_or(path);
            return c.join(rel);
        }
    }
    // Nothing exists on this path — fall back to lexical normalization.
    normalize_lexical(path)
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Sign-in credential files of AI CLIs: `.claude/.credentials.json` and
/// `.codex/auth.json`, under any parent directory. Compared case-insensitively:
/// macOS and Windows file systems are, and a not-yet-existing path keeps the
/// case it was requested with.
fn is_credential_store(path: &Path) -> bool {
    let file = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let dir = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    [(".claude", ".credentials.json"), (".codex", "auth.json")]
        .iter()
        .any(|(d, f)| dir.eq_ignore_ascii_case(d) && file.eq_ignore_ascii_case(f))
}

fn path_starts_with(path: &Path, prefix: &Path) -> bool {
    let mut p = path.components();
    for pc in prefix.components() {
        match p.next() {
            Some(c) if c == pc => {}
            _ => return false,
        }
    }
    true
}

fn push_canonical(roots: &mut Vec<PathBuf>, path: PathBuf) {
    let canonical = canonicalize_best_effort(&path);
    if !roots.iter().any(|r| r == &canonical) {
        roots.push(canonical);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn fixed_roots_allow_subpath() {
        let tmp = TempDir::new().unwrap();
        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        let f = tmp.path().join("a/b/c.txt");
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, "hi").unwrap();

        mgr.validate(&f, Some("tab1"), PathCapability::Read)
            .await
            .expect("subpath of registered cwd must pass");
    }

    #[tokio::test]
    async fn outside_root_rejected() {
        let tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        let f = outside.path().join("secret.txt");
        std::fs::write(&f, "shh").unwrap();

        mgr.validate(&f, Some("tab1"), PathCapability::Read)
            .await
            .expect_err("unrelated dir must be rejected");
    }

    #[tokio::test]
    async fn grant_allows_outside_path() {
        let tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        let f = outside.path().join("ok.txt");
        std::fs::write(&f, "ok").unwrap();

        mgr.add_grant("tab1", &f).await;
        mgr.validate(&f, Some("tab1"), PathCapability::Read)
            .await
            .expect("grant should allow this path");

        // Another tab without the grant is still rejected
        mgr.validate(&f, Some("tab2"), PathCapability::Read)
            .await
            .expect_err("other tab must not see tab1 grant");
    }

    #[tokio::test]
    async fn clear_grants_revokes_access() {
        let tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        let f = outside.path().join("ok.txt");
        std::fs::write(&f, "ok").unwrap();

        mgr.add_grant("tab1", &f).await;
        mgr.clear_grants("tab1").await;
        mgr.validate(&f, Some("tab1"), PathCapability::Read)
            .await
            .expect_err("cleared grant must be gone");
    }

    #[tokio::test]
    async fn traversal_rejected() {
        let tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        // Craft a path that tries to escape the registered cwd with `..`.
        let escape = tmp
            .path()
            .join("..")
            .join(outside.path().file_name().unwrap());

        mgr.validate(&escape, Some("tab1"), PathCapability::Read)
            .await
            .expect_err("'..' traversal must be rejected");
    }

    #[tokio::test]
    async fn tab_id_none_scans_all_grants() {
        let tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        let f = outside.path().join("ok.txt");
        std::fs::write(&f, "ok").unwrap();

        mgr.add_grant("tab1", &f).await;

        // No tab context but any tab's grant counts (file tree scan).
        mgr.validate(&f, None, PathCapability::Read)
            .await
            .expect("tab_id=None should consult all grants");
    }

    #[tokio::test]
    async fn credential_stores_rejected_even_inside_roots() {
        let tmp = TempDir::new().unwrap();
        let mgr = PathAccessManager::empty();
        mgr.register_cwd(tmp.path()).await;

        for (dir, file) in [(".claude", ".credentials.json"), (".codex", "auth.json")] {
            let f = tmp.path().join(dir).join(file);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(&f, "{}").unwrap();
            mgr.add_grant("tab1", &f).await;
            mgr.validate(&f, Some("tab1"), PathCapability::Read)
                .await
                .expect_err("credential store must never be accessible");
        }

        // A different case of a not-yet-existing credential file is refused too.
        let upper = tmp.path().join(".Claude").join(".Credentials.json");
        mgr.validate(&upper, Some("tab1"), PathCapability::Write)
            .await
            .expect_err("credential store must be refused in any letter case");

        // Other files in the same directories stay reachable.
        let settings = tmp.path().join(".claude").join("settings.json");
        std::fs::write(&settings, "{}").unwrap();
        mgr.validate(&settings, Some("tab1"), PathCapability::Read)
            .await
            .expect("non-credential files in ~/.claude stay allowed");
    }
}
