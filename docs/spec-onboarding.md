# Onboarding Spec

## Overview

When the user opens Stavebak for the first time (or when something is misconfigured), we need to ensure three things before they can use the app:

1. **Claude CLI is installed** (runtime dependency)
2. **User is authenticated** (has a valid Claude subscription / API key)
3. **Stavebak MCP server is registered** in `~/.claude.json`

The flow should feel instant for users who already have everything set up (like us), and guide new users through each missing piece without inventing custom auth — we lean on CC's own mechanisms.

---

## Flow

```
┌─────────────────────────────────────────────────────┐
│  App launch                                         │
│  ┌───────────┐                                      │
│  │ checking   │──── CLI found + auth ok + MCP ok ──→ MAIN APP │
│  └─────┬─────┘                                      │
│        │ CLI missing                                │
│        ▼                                            │
│  ┌───────────────┐                                  │
│  │ not_installed  │  "Stavebak needs Claude CLI"    │
│  │  [Install]     │──→ installing ──→ ↓             │
│  │  [Skip]        │                                 │
│  └────────────────┘                                 │
│        │ CLI found (installed or was already there) │
│        ▼                                            │
│  ┌───────────────┐                                  │
│  │ auth_check    │  (runs `claude auth status`      │
│  │               │   or equivalent bridge call)     │
│  └─────┬────────┬┘                                  │
│        │ ok     │ not authed                        │
│        │        ▼                                   │
│        │  ┌─────────────┐                           │
│        │  │ needs_auth   │                          │
│        │  │              │  Shows:                  │
│        │  │              │  - "Sign in to Claude"   │
│        │  │              │  - opens `claude login`  │
│        │  │              │    or links to claude.ai │
│        │  │  [Login]     │  - [Retry] after login   │
│        │  │  [Use API key]│ - or paste API key      │
│        │  └──────────────┘                          │
│        │        │ authed                            │
│        ▼        ▼                                   │
│  ┌───────────────┐                                  │
│  │ mcp_setup     │  ensureDefaultServer() — silent  │
│  │               │  if fails → show warning but     │
│  │               │  don't block (MCP is optional)   │
│  └───────┬───────┘                                  │
│          ▼                                          │
│  ┌───────────────┐                                  │
│  │ ready         │  "You're all set" (2s then go)   │
│  └───────────────┘                                  │
└─────────────────────────────────────────────────────┘
```

---

## What Jakub sees (CLI already installed, authed)

```
App opens → "checking" spinner (< 1s) → all 3 checks pass → straight to main app
```

No wizard screens shown. The `checking` state runs CLI detection, auth check, and MCP verify in sequence. If all pass, `setSetupCompleted(true)` fires immediately. The user never sees the onboarding.

---

## Steps in detail

### 1. CLI Detection (exists today)

No changes. `bridge.checkClaudeCli()` resolves CLI via 5-tier priority. If found, proceed to auth check. If not, show install screen (existing flow).

### 2. Auth Check (new)

**What it does:** Verify the user has valid Claude credentials.

**Implementation:** New Tauri command `check_claude_auth` that runs:

```
claude auth status
```

Parses output for:
- `Authenticated as ...` → ok, extract account info (email/name if available)
- Any error / exit code != 0 → not authed

**Store changes:** Add to `setupStore`:

```ts
type SetupStep =
  | 'checking'
  | 'not_installed'
  | 'installing'
  | 'install_failed'
  | 'auth_check'      // new
  | 'needs_auth'      // new
  | 'installed';      // rename to 'ready'

// new fields
authStatus: 'unknown' | 'ok' | 'missing';
accountName: string | null;
```

**UI for `needs_auth`:**

```
┌────────────────────────────────┐
│         [Stavebak icon]       │
│                                │
│   Sign in to Claude            │
│                                │
│   Stavebak uses Claude as its  │
│   AI runtime. You need an      │
│   active subscription or API   │
│   key to continue.             │
│                                │
│   ┌──────────────────────┐     │
│   │  ▶  Open Claude Login │     │  ← runs `claude login` in embedded terminal
│   └──────────────────────┘     │     or opens browser to claude.ai/login
│                                │
│   ┌──────────────────────┐     │
│   │  🔑  Use API Key     │     │  ← opens Settings > API tab to paste key
│   └──────────────────────┘     │
│                                │
│   [Retry]  after signing in    │
│                                │
│   (skip)                       │
└────────────────────────────────┘
```

Two paths:
- **Claude subscription** (Pro/Team/Enterprise): `claude login` opens browser OAuth, user authenticates, we poll/retry `auth status` until it passes
- **API key**: User pastes an Anthropic API key in Settings. Validated with a lightweight `/v1/messages` call (1 token max). Stored in the app's custom provider config (existing system).

### 3. MCP Server Setup (exists today, minor changes)

After auth passes, `ensureDefaultServer()` runs. This is non-blocking — if it fails, we show a small warning badge but still proceed to the main app. The MCP server adds Stavebak-specific tools but the app is usable without it.

**Change:** Surface the MCP health result briefly in the `ready` step:

```
✓ Claude CLI v1.2.3
✓ Authenticated as jakub@...
✓ Stavebak tools connected        ← or ⚠ "Tools unavailable — check Settings > MCP"
```

### 4. Ready (rename from `installed`)

Shown for 2 seconds with the summary above, then auto-transitions to main app.

---

## Tauri bridge additions

```rust
// New command
#[tauri::command]
async fn check_claude_auth(cli_path: Option<String>) -> Result<AuthStatus, String> {
    // Resolve CLI path (same as existing check_claude_cli)
    // Run: `claude auth status`
    // Parse output
    // Return { authenticated: bool, account: Option<String> }
}

struct AuthStatus {
    authenticated: bool,
    account: Option<String>,  // email or name if parseable
}
```

## SetupWizard changes

The wizard component gets two new step renders (`auth_check` and `needs_auth`) and the `installed` step becomes `ready` with the summary view.

The detection flow in `useEffect` becomes:

```ts
async function detect() {
  // 1. CLI check (existing)
  const status = await bridge.checkClaudeCli();
  if (!status.installed) { setStep('not_installed'); return; }
  setCliInfo(status.version, status.path);

  // 2. Auth check (new)
  setStep('auth_check');
  const auth = await bridge.checkClaudeAuth(status.path);
  if (!auth.authenticated) { setStep('needs_auth'); return; }
  setAccountName(auth.account);

  // 3. MCP (existing, non-blocking)
  await mcpStore.ensureDefaultServer().catch(() => {});
  mcpStore.checkHealth();

  // All good — skip wizard entirely
  setSetupCompleted(true);
}
```

---

## Edge cases

| Scenario | Behavior |
|---|---|
| CLI installed, auth ok, MCP ok | Skip wizard entirely (< 1s) |
| CLI installed, auth ok, MCP fails | Skip wizard, show warning badge in sidebar |
| CLI installed, auth expired/missing | Show `needs_auth` screen |
| CLI not installed | Show install screen, then auth check after install |
| User clicks Skip at any point | Goes to main app; features will fail gracefully with inline errors |
| API key user (no subscription) | Works via custom provider config; auth check recognizes this |
| Offline | CLI check passes (local binary), auth check may fail — show "check connection" hint |

---

## Not in scope

- Custom account creation / Stavebak accounts — we don't have our own auth
- Payment / subscription management — that's Anthropic's domain
- Claude Code ToS acceptance — CC handles this on first `claude` invocation; if the user runs login, they'll see it there
- Automatic re-check on app focus — just first launch and manual retry
