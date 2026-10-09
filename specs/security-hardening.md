# Security Hardening

Strip all Chinese infrastructure, close XSS surface, lock supply chain. After this, the app talks only to user-configured API endpoints and stavebak.cz/mcp.

## 1. Set restrictive CSP

**File:** `src-tauri/tauri.conf.json` line 26

Replace `"csp": null` with:

```json
"csp": "default-src 'self'; script-src 'self'; connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:"
```

`connect-src 'self' https:` allows the frontend to reach user-configured HTTPS API endpoints (Anthropic, OpenRouter, etc.) while blocking non-HTTPS and protocol-level exfiltration (DNS prefetch, WebSocket to random hosts). If Tauri IPC breaks under this CSP, add `ipc:` or `tauri:` schemes as needed.

**Verify:** app launches, chat works, settings save, MCP panel loads.

## 2. Remove Feishu feedback module

**Goal:** Eliminate the entire feedback-to-Feishu pipeline.

1. Delete `src-tauri/src/commands/feedback.rs`
2. Remove `mod feedback` and `pub use feedback::*` from `src-tauri/src/commands/mod.rs`
3. Remove the `submit_feedback` Tauri command registration from `src-tauri/src/lib.rs` (the `.invoke_handler(tauri::generate_handler![...])` block)
4. In frontend, find the feedback UI (grep for `submit_feedback` or `submitFeedback` in `src/`) and either:
   - Remove the feedback button/dialog entirely, OR
   - Replace with a `mailto:` link or link to a GitHub Issues page
5. Remove `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_RECEIVE_ID` references from any build scripts or CI

**Verify:** app builds, no Feishu imports remain (`grep -r "feishu" src-tauri/`).

## 3. Remove `tauri-plugin-mcp` dependency

**Why:** Unpinned git dependency from personal repo (P3GLEG). Not used in core flow -- Claude Code CLI handles MCP natively.

1. Remove from `src-tauri/Cargo.toml`: the `tauri-plugin-mcp` line
2. Remove from `src-tauri/src/lib.rs`: any `use tauri_plugin_mcp`, `.plugin(tauri_plugin_mcp::init())` or similar registration
3. Run `cargo check` in `src-tauri/` to find and fix any remaining references

**Verify:** `cargo build` succeeds, MCP servers still work (they're configured via `~/.claude.json` and passed to CLI via `--mcp-config`).

## 4. Remove updater Chinese endpoints

**File:** `src-tauri/tauri.conf.json` plugins.updater section

Replace the three endpoints with your own GitHub releases URL:

```json
"endpoints": [
  "https://github.com/Juicyscoop88/stavebak-desktop/releases/latest/download/latest.json"
]
```

Generate a new minisign keypair (`minisign -G`) and replace the `pubkey`. Store the private key securely for signing releases.

**Verify:** updater config points only to your repo.

## 5. Remove `herear.cn` CLI mirror and Google connectivity check

**File:** `src-tauri/src/lib.rs`

1. **Line 102:** Remove `const CLI_MIRROR_BASE` (`herear.cn:8443`)
2. **Lines ~5806-5831:** Remove or replace the `google.com/generate_204` connectivity check. Since this app targets Czech users (not China), GFW detection is unnecessary. Replace with a simple connectivity check to `https://api.anthropic.com` or remove entirely.
3. **Lines ~6050-6130:** In the CLI download logic, remove all `herear.cn` mirror branches. Keep only:
   - GCS (Google Cloud Storage) as primary
   - npm registry as fallback
4. Remove npmmirror and Huawei Cloud fallbacks (lines referencing `npmmirror`, `huaweicloud`) -- not needed for Czech users.

**Verify:** `cargo build` succeeds, CLI download works without Chinese mirrors.

## 6. Remove `rehype-raw`, harden markdown rendering

**File:** `src/components/shared/MarkdownRenderer.tsx` line 3

1. Remove `import rehypeRaw from 'rehype-raw'` and its usage in the rehype plugins array
2. Keep `rehype-sanitize` and `dompurify` -- they provide defense-in-depth
3. Remove `rehype-raw` from `package.json` dependencies
4. Run `pnpm install` to update lockfile

**Impact:** Raw HTML in AI-generated markdown will no longer render. This is the correct behavior for a security-critical app. Markdown formatting (bold, code, lists, tables) still works.

**Verify:** chat messages render correctly, code blocks work, no `<script>` or `<img>` injection possible.
