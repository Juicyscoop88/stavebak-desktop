# Cold Start Optimization — Implementation Spec

> Goal: Reduce time from "user hits Enter" to "CLI ready" from worst-case **~8s** to **<300ms** consistently.

## Architecture Premise: CC CLI Is The Only Backend

Stavebak is a **dedicated Claude Code CLI wrapper** — not a generic LLM harness. The CC CLI process (spawned via stdin/stdout stream-json) is the sole backend. This unlocks aggressive simplification:

| Current complexity | CC-only simplification |
|---|---|
| 4-tier CLI resolver (Official → System → AppLocal → VersionMgr → Dynamic) with `npm root -g` (3s), `which` (3s), login shell PATH | **2-tier**: Official install path + bundled binary. Done. |
| Provider system (OpenAI, Gemini, custom base URLs, env var resolution) | **Remove entirely** — CC CLI handles model selection internally |
| Custom MCP scratch config (read ~/.claude.json, filter, write temp file, pass --mcp-config) | **Delegate to CLI** — let CC's built-in deferred MCP handle it, or pass --strict-mcp-config with zero servers |
| `resolve_provider_env()` + inherited key cleanup | **Remove** — no provider env vars needed, CC CLI reads its own config |
| Proxy detection (login shell, scutil, TCP port probing) | **Keep but simplify** — CC CLI needs proxy env, but cache aggressively at app start |

The 4-tier resolver alone accounts for 0–6s of waste. Replacing it with "check 2 known paths, fallback to bundled binary" reduces it to <5ms.

### Dead code candidates (post-optimization)

- `resolve_provider_env()` and entire `providerStore` if providers are removed
- `collect_tiered_dirs()` tiers 1–4 (keep T0 Official only)
- `get_npm_global_bin()`, `cmd_with_timeout("npm", ...)`, `cmd_with_timeout("which", ...)`
- Provider-specific CLI args (`--setting-sources`, API key env vars)
- `build_enriched_path()` complexity (only need official path + bundled)

---

## Current Bottleneck Map

```
start_claude_session() critical path (worst case):

T+0ms       path_access + cleanup                    1ms
T+1ms       build_mcp_scratch_config()                5ms
T+6ms    ┌─ find_claude_binary()
         │    collect_tiered_dirs() — ALL tiers upfront
T+6ms    │    T0 Official: fs checks                  20ms
T+26ms   │    T1 System: fs + npm root -g             3000ms ← TIMEOUT
T+3026ms │    T2 AppLocal: fs checks                  5ms
T+3031ms │    T3 VersionMgr: fs + nvm scan            30ms
T+3061ms │    T4 Dynamic: login_shell_extra_path()    200-1500ms ← SHELL SPAWN
         │                 which claude               3000ms ← TIMEOUT
T+6261ms └─ resolve() iterates dirs                   10ms
T+6271ms    build_enriched_path()                     50ms (cached after 1st)
T+6321ms    resolve_provider_env()                    10ms
T+6331ms    login_shell_proxy_env()                   200-1500ms ← SHELL SPAWN
T+7831ms    resolve_proxy_url() + port probe          400ms
T+8231ms    Command::spawn()                          50ms
T+8281ms    CLI bootstrap (Node/Bun)                  200-800ms
T+9081ms    MCP server init                           200-30000ms
T+9281ms    system:init emitted → CLI READY
```

**Root causes ranked by impact:**
1. `collect_tiered_dirs()` runs ALL tiers eagerly — `npm root -g` (3s) and `which` (3s) execute even when T0 has a hit
2. `login_shell_extra_path()` + `login_shell_proxy_env()` — two sequential shell spawns, ~1.5s each, only on first session
3. No CLI path caching between sessions (re-resolves every cold start)
4. `resolve_proxy_url()` does synchronous TCP port probing (4 ports × 80ms)
5. No pre-warming — CLI process only starts when user sends first message

---

## OPT-0: Radical CLI Resolver Simplification (CC-only)

**File:** `src-tauri/src/commands/cli_resolver.rs`
**Savings:** Eliminates 0–6s of resolver overhead entirely
**Replaces:** OPT-1, OPT-3, OPT-8, OPT-9 (all become unnecessary)

### Problem

The 4-tier resolver with `npm root -g`, `which`, login shell PATH exists to support every possible CLI installation method. Since Stavebak is a CC-only wrapper, we know exactly where the binary lives.

### Solution: 3-step lookup, no subprocesses

```rust
pub fn find_binary(app: &AppHandle) -> Option<String> {
    // 1. User-pinned CLI (explicit override in settings)
    if let Some(pinned) = get_pinned_cli() {
        if is_valid_executable(Path::new(&pinned)) {
            return Some(pinned);
        }
    }

    // 2. Official CC install paths (filesystem check only, <1ms)
    let official_paths = official_install_paths();
    for path in &official_paths {
        if is_native_binary(Path::new(path)) || is_valid_executable(Path::new(path)) {
            return Some(path.clone());
        }
    }

    // 3. Bundled binary (shipped with Stavebak)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("claude");
        if is_native_binary(&bundled) {
            return Some(bundled.to_string_lossy().to_string());
        }
    }

    None
}

fn official_install_paths() -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        // Claude Desktop bundled CLI (newest version)
        #[cfg(target_os = "macos")]
        {
            let vdir = home.join("Library/Application Support/Claude/claude-code");
            if let Some(bin) = find_newest_version_bin(&vdir, "claude") {
                paths.push(bin);
            }
        }
        // Official native installer
        paths.push(home.join(".claude/local/claude").to_string_lossy().to_string());
    }
    paths
}
```

**Total time: <5ms.** No subprocesses, no timeouts, no shell spawns.

### What about users who installed via npm/volta/nvm?

Show a one-time setup dialog: "Stavebak couldn't find Claude Code. Install it via `claude --install` or point us to the binary in Settings." This is better UX than silently searching for 6 seconds and maybe finding a stale npm install.

### Migration

Keep the old `collect_tiered_dirs()` + `resolve()` behind a feature flag or in a `cli_resolver::legacy` module for the diagnostic `scan_all()` command (Settings → CLI tab). The hot path uses the simplified resolver.

---

## OPT-1: Lazy Tier Collection in CLI Resolver

**File:** `src-tauri/src/commands/cli_resolver.rs`
**Functions:** `collect_tiered_dirs()` (L326), `resolve()` (L624)
**Savings:** 0–6s (eliminates `npm root -g` + `which` timeouts when binary found early)

### Problem

`resolve()` calls `collect_tiered_dirs()` which builds ALL tier directories upfront in one Vec, then iterates. Even if the binary is at `~/.claude/local` (Tier 0), the function still:
- Runs `npm root -g` with 3s timeout (Tier 1, L440)
- Spawns login shell for PATH (Tier 4, L572)
- Runs `which claude` with 3s timeout (Tier 4, L585)

### Solution

Replace eager collection with a lazy tier-by-tier iterator pattern.

```rust
// NEW: collect dirs for a single tier only
fn collect_tier_dirs(tier: CliSource) -> Vec<TieredDir> { ... }

// NEW: resolve with early exit per tier
pub fn resolve() -> Option<(String, CliSource)> {
    // Check pinned first (instant)
    if let Some(pinned) = get_pinned_cli() {
        let p = Path::new(&pinned);
        if is_native_binary(p) || is_valid_executable(p) {
            return Some((pinned, CliSource::System));
        }
    }

    let names = bin_names();
    for tier in [
        CliSource::Official,
        CliSource::System,
        CliSource::AppLocal,
        CliSource::VersionManager,
        CliSource::Dynamic,
    ] {
        let dirs = collect_tier_dirs(tier);
        for td in &dirs {
            for name in names {
                let candidate = Path::new(&td.path).join(name);
                if is_native_binary(&candidate) {
                    let path = candidate.to_string_lossy().to_string();
                    // Auto-pin for next time (OPT-3)
                    auto_pin_cli(&path);
                    return Some((path, td.source));
                }
            }
            for name in names {
                let candidate = Path::new(&td.path).join(name);
                if is_valid_executable(&candidate) {
                    let path = candidate.to_string_lossy().to_string();
                    auto_pin_cli(&path);
                    return Some((path, td.source));
                }
            }
        }
    }
    None
}
```

Split `collect_tiered_dirs()` into `collect_tier_dirs(tier)` that only collects directories for one tier. The expensive operations (`npm root -g`, `login_shell_extra_path`, `which`) only run if earlier tiers didn't find anything.

### Changes

1. **`cli_resolver.rs` — split `collect_tiered_dirs()`** into:
   - `collect_tier0_official() -> Vec<TieredDir>` — fs-only, always fast (~20ms)
   - `collect_tier1_system() -> Vec<TieredDir>` — includes `npm root -g` (up to 3s)
   - `collect_tier2_applocal() -> Vec<TieredDir>` — fs-only, fast
   - `collect_tier3_versionmgr() -> Vec<TieredDir>` — fs-only, ~30ms
   - `collect_tier4_dynamic() -> Vec<TieredDir>` — login shell + `which` (up to 4.5s)

2. **`cli_resolver.rs` — rewrite `resolve()`** to iterate tier-by-tier with early return.

3. **`cli_resolver.rs` — keep `collect_tiered_dirs()`** for `resolve_ordered()` and `scan_all()` (diagnostic tools, not on hot path). Rebuild it by calling all `collect_tier*` functions.

### Compatibility

- `resolve_ordered()` (used by `check_claude_cli`) still needs all tiers — keep `collect_tiered_dirs()` as composition of per-tier fns.
- `scan_all()` likewise.
- The hot path (`resolve()` → `find_binary()`) benefits from early exit.

---

## OPT-2: Eager Shell Probes at App Startup

**File:** `src-tauri/src/lib.rs`
**Functions:** `login_shell_extra_path()` (L200), `login_shell_proxy_env()` (L234)
**Location:** `tauri::Builder::setup()` (L7791)
**Savings:** 0.4–3s on first session (moves shell spawn off critical path)

### Problem

Both functions use `OnceLock` — first call blocks for shell spawn (~200-1500ms each), subsequent calls instant. Currently:
- `login_shell_proxy_env()` is called in `setup()` (L7803) — already warm ✓
- `login_shell_extra_path()` is NOT called until `collect_tiered_dirs()` during session start — cold on first session ✗

### Solution

Add `login_shell_extra_path()` warm-up to `setup()`, on a background thread so it doesn't block window creation.

```rust
.setup(|app| {
    // Existing: proxy env (already blocks setup — move to background)
    // NEW: warm both shell caches in parallel on background threads
    std::thread::spawn(|| {
        let _ = login_shell_extra_path();
    });
    std::thread::spawn(|| {
        let _ = login_shell_proxy_env();
    });

    // ... rest of setup (window creation, updater plugin) ...
    Ok(())
})
```

### Current issue with `login_shell_proxy_env()` in setup

Currently L7803-7811 calls `login_shell_proxy_env()` synchronously in setup and sets env vars. This blocks app window creation by ~200-1500ms on first launch.

**Fix:** Move the env var injection to a `std::thread::spawn` too, but ensure it completes before the updater plugin (which needs proxy vars) makes any network calls. Since the updater runs async after setup completes, the thread will almost certainly finish in time. Add a `std::sync::Barrier` or `OnceLock` guard if paranoid.

```rust
.setup(|app| {
    // Warm shell caches on background threads — completes before first session start
    std::thread::spawn(|| { let _ = login_shell_extra_path(); });

    // Proxy env: warm cache + inject into process env (needed by updater)
    // Use a thread but join before returning from setup so env vars are
    // available for the updater plugin registered below.
    let proxy_thread = std::thread::spawn(|| {
        let proxy_env = login_shell_proxy_env();
        for (k, v) in proxy_env {
            if std::env::var(k).is_err() {
                unsafe { std::env::set_var(k, v); }
            }
        }
    });
    // Wait for proxy — without it the updater can't reach the API through proxies.
    // This is 200-1500ms on first launch, but the PATH thread runs in parallel.
    let _ = proxy_thread.join();

    cleanup_tracked_sessions();

    #[cfg(desktop)]
    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

    Ok(())
})
```

**Net effect:** `login_shell_extra_path()` runs in parallel with the proxy thread, saving ~200-1500ms vs current sequential execution.

---

## OPT-3: Auto-Pin CLI After First Resolve

**File:** `src-tauri/src/commands/cli_resolver.rs`
**Savings:** 0.1–6s on all sessions after the first

### Problem

`find_binary()` checks pinned CLI first (instant), but falls through to full `resolve()` if no pin exists. Users who installed Claude CLI normally never have a pin — every session pays the resolve cost.

### Solution

After `resolve()` finds a binary, automatically pin it. Invalidate on:
- CLI update/reinstall (setup wizard)
- User explicitly changes CLI path in settings
- Pinned path no longer valid (already handled — L903-908 falls through)

```rust
// In resolve(), after finding a binary:
fn auto_pin_cli(path: &str) {
    // Don't auto-pin Dynamic tier (which/PATH results are unstable)
    // Only pin Official, System, AppLocal, VersionManager
    if let Some(pin_path) = pin_file_path() {
        let pin = CliPin { path: path.to_string() };
        if let Ok(json) = serde_json::to_string_pretty(&pin) {
            let _ = std::fs::create_dir_all(pin_path.parent().unwrap());
            let _ = std::fs::write(&pin_path, json);
            eprintln!("[cli_resolver] auto-pinned: {}", path);
        }
    }
}

// In find_binary(), add re-validation with version check:
pub fn find_binary() -> Option<String> {
    if let Some(pinned) = get_pinned_cli() {
        let p = Path::new(&pinned);
        if is_native_binary(p) || is_valid_executable(p) {
            return Some(pinned);
        }
        eprintln!("[cli_resolver] pinned CLI '{}' invalid, re-resolving", pinned);
        clear_pin(); // Remove stale pin
    }
    let result = resolve();
    if let Some((ref path, source)) = result {
        // Only auto-pin stable sources
        if !matches!(source, CliSource::Dynamic) {
            auto_pin_cli(path);
        }
    }
    result.map(|(path, _)| path)
}
```

### Edge case: CLI updates

When the CLI is updated (new version installed), the old pinned path may still be valid but outdated. Add a version-aware invalidation:

```rust
// Called from setup wizard / CLI install commands
pub fn invalidate_pin() {
    if let Some(pin_path) = pin_file_path() {
        let _ = std::fs::remove_file(&pin_path);
        eprintln!("[cli_resolver] pin invalidated");
    }
}
```

Wire `invalidate_pin()` into:
- `install_cli_npm` command
- `set_pinned_cli` command (user override)
- `check_claude_cli` when it detects a newer version at a higher-priority tier

---

## OPT-4: Pre-Warm CLI Process on App Start

**Files:** `src-tauri/src/lib.rs`, `src/App.tsx`, `src/stores/chatStore.ts`, `src/hooks/useStreamProcessor.ts`
**Savings:** 0.5–2s (CLI bootstrap time moved off user-visible path)

### Problem

CLI process is only spawned when the user sends their first message. The CLI needs 200-800ms to bootstrap (Bun/Node runtime init, config loading, MCP connect).

### Background

The frontend already has infrastructure for this:
- `chatStore.ts` L100-108: `stdinReady`, `pendingReadyMessage` fields
- `InputBar.tsx` L1035-1039: holds first message until `system:init` arrives
- `useStreamProcessor.ts`: flushes `pendingReadyMessage` on `system:init`

### Solution

Spawn a "warm" CLI process during app startup, before the user types anything. When they send their first message, the CLI is already past `system:init`.

#### Backend: new Tauri command `prewarm_cli_session`

```rust
#[tauri::command]
async fn prewarm_cli_session(
    app: AppHandle,
    state: State<'_, ProcessManager>,
    stdin_mgr: State<'_, StdinManager>,
    bypass_modes: State<'_, BypassModeMap>,
    path_access: State<'_, PathAccessManager>,
    params: PrewarmParams, // cwd, model, provider_id, permission_mode, thinking_level
) -> Result<SessionInfo, String> {
    // Reuse start_claude_session internally but:
    // 1. Don't send any user message
    // 2. Return SessionInfo with stdin_id
    // 3. The process sits idle waiting for input after system:init
    start_claude_session(app, state, stdin_mgr, bypass_modes, path_access,
        StartSessionParams {
            cwd: params.cwd,
            model: params.model,
            provider_id: params.provider_id,
            permission_mode: params.permission_mode,
            thinking_level: params.thinking_level,
            // No initial message, no resume
            resume_session_id: None,
            session_id: Some(format!("prewarm-{}", uuid::Uuid::new_v4())),
            ..Default::default()
        }
    ).await
}
```

#### Frontend: pre-warm on mount

In `App.tsx`, after initial setup:

```typescript
// App.tsx — inside useEffect on mount
useEffect(() => {
  const prewarm = async () => {
    const settings = useSettingsStore.getState();
    const recentProject = settings.recentProjects?.[0];
    if (!recentProject) return;

    const info = await bridge.prewarmCliSession({
      cwd: recentProject,
      model: settings.model,
      providerId: settings.providerId,
      permissionMode: settings.permissionMode,
      thinkingLevel: settings.thinkingLevel,
    });

    // Store the pre-warmed stdin for the first tab to claim
    useSessionStore.getState().setPrewarmedStdin(info);
  };

  // Delay slightly so window renders first
  requestIdleCallback(prewarm);
}, []);
```

#### InputBar: claim pre-warmed process

When user sends first message, InputBar checks if a pre-warmed session exists with matching config (cwd, model, provider). If yes, reuse it instead of spawning new. The `spawnConfigHash` comparison already exists (L986) — extend it to cover pre-warm.

### Invalidation

Pre-warmed process becomes stale when user:
- Switches project → kill prewarm, start new one
- Changes model/provider → kill prewarm, start new one
- Changes thinking level → kill prewarm, start new one

Store a `prewarmConfigHash` and compare before claiming.

---

## OPT-5: Async Proxy Detection

**File:** `src-tauri/src/lib.rs`
**Functions:** `resolve_proxy_url()` (L344), `probe_local_proxy()` (L323)
**Savings:** 80–400ms

### Problem

`resolve_proxy_url()` is called synchronously during `start_claude_session` (L1930). If no proxy env vars exist, it:
1. Calls `scutil --proxy` (macOS) — subprocess, ~50ms
2. Falls back to `probe_local_proxy()` which does synchronous TCP connects to 4 ports (7890, 1087, 8080, 1080) with 80ms timeout each — up to 320ms

### Solution

#### A) Move proxy detection to app startup (like OPT-2)

```rust
// In setup(), alongside shell probes:
static PROXY_CACHE: OnceLock<Option<String>> = OnceLock::new();

fn cached_proxy_url() -> Option<&'static String> {
    PROXY_CACHE.get_or_init(|| resolve_proxy_url()).as_ref()
}

// Warm in setup:
std::thread::spawn(|| { let _ = cached_proxy_url(); });
```

Then in `start_claude_session`, use `cached_proxy_url()` instead of `resolve_proxy_url()`.

#### B) Async TCP probing (if keeping lazy detection)

Replace `probe_local_proxy()` with tokio async version:

```rust
async fn probe_local_proxy_async() -> Option<String> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let ports = [7890u16, 1087, 8080, 1080];
    let futures: Vec<_> = ports.iter().map(|&port| {
        timeout(Duration::from_millis(80),
            TcpStream::connect(("127.0.0.1", port)))
    }).collect();

    // All ports probed in PARALLEL — max 80ms total instead of 320ms
    let results = futures::future::join_all(futures).await;
    for (i, result) in results.iter().enumerate() {
        if result.is_ok() {
            return Some(format!("http://127.0.0.1:{}", ports[i]));
        }
    }
    None
}
```

**Recommended: Option A** — simpler, eliminates the cost entirely from session start.

---

## OPT-6: Bundle Native CLI Binary

**File:** `src-tauri/tauri.conf.json`, build scripts
**Savings:** Eliminates CLI resolver entirely for bundled builds

### Problem

VS Code extension ships its own `resources/native-binary/claude` — zero PATH lookup, zero shell spawn. Stavebak currently relies on finding a system-installed CLI.

### Solution

Bundle the Claude CLI native binary as a Tauri resource.

#### Build-time

```jsonc
// tauri.conf.json
{
  "bundle": {
    "resources": [
      { "src": "resources/claude", "target": "claude" }
    ]
  }
}
```

Add a build script that:
1. Downloads the appropriate platform binary from the official versioned directory (`~/Library/Application Support/Claude/claude-code/*/claude`)
2. Or copies from the current system install
3. Places it at `src-tauri/resources/claude`

```bash
#!/bin/bash
# scripts/bundle-cli.sh
CLI_PATH=$(~/.claude/local/claude 2>/dev/null || which claude)
cp "$CLI_PATH" src-tauri/resources/claude
chmod +x src-tauri/resources/claude
```

#### Runtime: prefer bundled, fallback to system

```rust
fn find_claude_binary() -> Option<String> {
    // Priority 1: user-pinned CLI
    if let Some(pinned) = get_pinned_cli() {
        if is_valid(&pinned) { return Some(pinned); }
    }

    // Priority 2: bundled binary (Tauri resource)
    if let Some(resource_dir) = app_handle.path().resource_dir().ok() {
        let bundled = resource_dir.join("claude");
        if is_native_binary(&bundled) {
            return Some(bundled.to_string_lossy().to_string());
        }
    }

    // Priority 3: system resolve (lazy tiers)
    resolve().map(|(path, _)| path)
}
```

### Licensing concern

The Claude CLI binary is distributed under Anthropic's terms. Bundling it requires:
- Checking if redistribution is permitted
- Auto-update mechanism to keep the bundled binary current
- Fallback to system binary if bundled is outdated

### Versioning

Store the bundled CLI version in `src-tauri/resources/cli-version.json`. On app startup, compare with the system-installed version. If system is newer, prefer system. If bundled is newer (or system missing), use bundled.

---

## OPT-7: Deferred MCP Server Init

**File:** `src-tauri/src/lib.rs` — `build_mcp_scratch_config()` (L1600)
**Savings:** 0.2–30s of CLI startup time

### Problem

Stavebak passes `--strict-mcp-config` (skip global MCP) but then writes user's MCP servers from `~/.claude.json` into a scratch config and passes via `--mcp-config`. This means user servers (especially `npx -y` ones like huggingface, reddit) still initialize at CLI startup.

### Current flow

```
~/.claude.json has 10+ MCP servers
  → build_mcp_scratch_config() writes ALL of them to scratch file
  → CLI loads scratch file → initializes ALL servers at startup
  → system:init delayed by slowest server (npx -y can take 5-30s)
```

### Solution: Categorize servers by transport speed

```rust
fn build_mcp_scratch_config(stdin_id: &str) -> Option<std::path::PathBuf> {
    // ... read ~/.claude.json ...

    // Separate fast servers (http, pre-installed binaries) from slow ones (npx, uvx)
    let mut fast_servers = serde_json::Map::new();
    let mut deferred_servers = serde_json::Map::new();

    for (name, config) in mcp_servers.iter() {
        if is_fast_mcp_server(config) {
            fast_servers.insert(name.clone(), config.clone());
        } else {
            deferred_servers.insert(name.clone(), config.clone());
        }
    }

    // Write only fast servers to scratch config — they init in <100ms
    // Deferred servers get loaded lazily when the model calls ToolSearch
    // (Claude CLI already supports this via startDeferredMcpServers)

    // ... write fast_servers to scratch file ...
}

fn is_fast_mcp_server(config: &serde_json::Value) -> bool {
    // HTTP transport = instant
    if config.get("type").and_then(|t| t.as_str()) == Some("http") {
        return true;
    }
    // Stdio with direct binary (no npx/uvx/bunx wrapper) = fast
    if let Some(cmd) = config.get("command").and_then(|c| c.as_str()) {
        let slow_wrappers = ["npx", "uvx", "bunx", "pipx"];
        return !slow_wrappers.iter().any(|w| cmd.contains(w));
    }
    false
}
```

### Alternative: Don't pass scratch config at all

If the CLI's built-in deferred MCP is sufficient (tools show up in ToolSearch, schemas loaded on demand), Stavebak could skip the scratch config entirely and let the CLI handle it:

```rust
// Remove --strict-mcp-config flag
// Remove --mcp-config scratch file
// Let CLI load ~/.claude.json natively with its own deferred loading
```

**Risk:** The CLI might eagerly init all servers without `--strict-mcp-config`. Needs testing.

**Recommended approach:** Keep `--strict-mcp-config`, pass only HTTP-transport servers in scratch config, let user add others via the Stavebak MCP settings panel with explicit "eager" vs "deferred" toggle.

---

## OPT-8: CLI Resolver Result Caching with OnceLock

**File:** `src-tauri/src/commands/cli_resolver.rs`
**Savings:** 0.1–6s on 2nd+ session in same app lifecycle

### Problem

Even with lazy tiers (OPT-1), every session start calls `find_binary()` → `resolve()`. Within a single app run, the CLI binary doesn't change — no need to re-resolve.

### Solution

```rust
static RESOLVED_CLI: OnceLock<Option<String>> = OnceLock::new();

pub fn find_binary() -> Option<String> {
    // Check pinned first (may have been set by user during this session)
    if let Some(pinned) = get_pinned_cli() {
        let p = Path::new(&pinned);
        if is_native_binary(p) || is_valid_executable(p) {
            return Some(pinned);
        }
    }

    RESOLVED_CLI.get_or_init(|| {
        resolve().map(|(path, _)| path)
    }).clone()
}

/// Call when CLI might have changed (install, settings change)
pub fn invalidate_cli_cache() {
    // OnceLock can't be reset — use a Mutex<Option<String>> instead
}
```

Since `OnceLock` can't be reset, use `parking_lot::RwLock<Option<String>>` for resettable cache:

```rust
static RESOLVED_CLI: RwLock<Option<Option<String>>> = RwLock::new(None);

pub fn find_binary_cached() -> Option<String> {
    // Fast path: cache hit
    if let Some(cached) = RESOLVED_CLI.read().as_ref() {
        return cached.clone();
    }

    // Slow path: resolve and cache
    let result = find_binary();
    *RESOLVED_CLI.write() = Some(result.clone());
    result
}

pub fn invalidate_cli_cache() {
    *RESOLVED_CLI.write() = None;
}
```

---

## OPT-9: Parallel `npm root -g` + `which` in Tier Collection

**File:** `src-tauri/src/commands/cli_resolver.rs`
**Savings:** Up to 3s (when both are needed — the slower one runs free)

### Problem

If lazy tiers (OPT-1) don't find the binary in T0-T2, Tier 1's `npm root -g` (3s timeout) and Tier 4's `which claude` (3s timeout) run sequentially.

### Solution

When Tier 0+2+3 miss, run Tier 1 and Tier 4 in parallel:

```rust
fn resolve_with_parallel_fallback() -> Option<(String, CliSource)> {
    let names = bin_names();

    // Fast tiers: T0, T2, T3 (filesystem only, no subprocesses)
    for tier in [CliSource::Official, CliSource::AppLocal, CliSource::VersionManager] {
        let dirs = collect_tier_dirs(tier);
        if let Some(result) = search_dirs(&dirs, names) {
            return Some(result);
        }
    }

    // Slow tiers: T1 (npm root -g) and T4 (login shell + which) in parallel
    let (tx, rx) = std::sync::mpsc::channel();
    let tx2 = tx.clone();

    std::thread::spawn(move || {
        let dirs = collect_tier1_system();
        tx.send((dirs, 1)).ok();
    });
    std::thread::spawn(move || {
        let dirs = collect_tier4_dynamic();
        tx2.send((dirs, 4)).ok();
    });

    let mut all_dirs = Vec::new();
    for _ in 0..2 {
        if let Ok((dirs, _tier)) = rx.recv() {
            // Check immediately as each tier completes
            if let Some(result) = search_dirs(&dirs, names) {
                return Some(result);
            }
            all_dirs.extend(dirs);
        }
    }

    None
}
```

---

## Implementation Priority & Phasing

### Phase 1: CC-only simplification (1–2 days) ⭐ START HERE

| Opt | Description | Risk | Savings |
|-----|-------------|------|---------|
| **OPT-0** | Radical CLI resolver (3-step, no subprocesses) | Low (old resolver kept for diagnostics) | **0–6s eliminated** |
| **OPT-2** | Eager shell probes in setup() | None (additive) | 0.4–3s first session |
| **OPT-5** | Cache proxy detection at app start | Low | 80–400ms |

**After Phase 1:** Typical session start drops from ~3s to ~50ms. Worst case from ~8s to ~500ms.

OPT-0 makes OPT-1 (lazy tiers), OPT-3 (auto-pin), OPT-8 (OnceLock cache), and OPT-9 (parallel tiers) **unnecessary** — they optimized a resolver that no longer exists.

### Phase 2: Pre-warm & MCP (2–3 days)

| Opt | Description | Risk | Savings |
|-----|-------------|------|---------|
| **OPT-4** | Pre-warm CLI on app start | Medium (state mgmt) | 0.5–2s perceived → ~0ms |
| **OPT-7** | Deferred MCP server init | Medium (behavior change) | 0.2–30s |

**After Phase 2:** Perceived latency ~50ms — CLI is already running when user types.

### Phase 3: Bundle CLI + strip dead code (future)

| Opt | Description | Risk | Savings |
|-----|-------------|------|---------|
| **OPT-6** | Bundle native CLI binary | Medium (licensing, updates) | Eliminates resolver fallback |
| **—** | Remove provider system (providerStore, resolve_provider_env) | Medium (large diff) | Simplifies codebase, removes ~500 LOC |
| **—** | Remove multi-harness abstractions | Medium | Cleaner architecture |

### Superseded (no longer needed after OPT-0)

| Opt | Description | Why superseded |
|-----|-------------|----------------|
| OPT-1 | Lazy tier collection | No tiers to iterate — 3-step lookup |
| OPT-3 | Auto-pin CLI | Official path check is <1ms, no need to cache |
| OPT-8 | OnceLock CLI cache | <5ms resolver doesn't need caching |
| OPT-9 | Parallel slow tiers | No slow tiers exist |

---

## Expected Results

### Before (current state)

```
Worst:  ~8000ms  (no pin, npm timeout, which timeout, cold shells, MCP servers)
Typical: ~3000ms  (T0 hit but still collects all tiers, cold shells)
Best:    ~300ms   (pinned + cached shells + no MCP)
```

### After Phase 1: CC-only resolver + eager probes

```
Worst:   ~500ms  (CLI not at official path → "install CC" dialog, cold proxy)
Typical:  ~50ms  (official path hit + cached proxy)
Best:     ~20ms  (official path + no proxy needed)
```

### After Phase 2: Pre-warm + deferred MCP

```
Perceived: ~0ms  (CLI already running, system:init already received)
Actual:    ~50ms (stdin write + event propagation)
```

---

## Testing

### Benchmarks to add

```bash
# Measure CLI resolver time
time claude --version  # baseline: how fast is the CLI itself?

# Measure full session start
# Add timing logs in start_claude_session:
eprintln!("[Stavebak:perf] find_binary: {}ms", elapsed);
eprintln!("[Stavebak:perf] env_resolve: {}ms", elapsed);
eprintln!("[Stavebak:perf] spawn: {}ms", elapsed);
eprintln!("[Stavebak:perf] total_to_spawn: {}ms", elapsed);
```

### Regression tests

- CLI found at T0 → resolver returns in <50ms
- CLI found at T4 only → resolver returns in <6s (parallel tiers)
- Auto-pin works → second resolve returns in <5ms
- Pre-warm session reusable after model/provider match
- Pre-warm session killed on config mismatch
- Proxy detection doesn't block session start
- MCP scratch config only includes fast servers
