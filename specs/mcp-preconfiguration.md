# MCP Preconfiguration: stavebak.cz

The app should come with stavebak.cz/mcp preconfigured so users don't need to set up anything.

## How MCP works in this app

1. Frontend manages MCP servers in `~/.claude.json` under `mcpServers`
2. On session start, Rust reads `mcpServers`, writes temp file, passes to CLI via `--mcp-config`
3. Claude Code CLI connects to MCP servers and exposes their tools

## What to do

### 1. Default MCP server on first launch

**File:** `src/stores/mcpStore.ts` (and related)

On first launch (or when `mcpServers` is empty), auto-add:

```json
{
  "stavebak": {
    "type": "streamable-http",
    "url": "https://stavebak.cz/mcp"
  }
}
```

This should be written to `~/.claude.json` under `mcpServers` if not already present. Do NOT overwrite user's existing MCP config -- only add if `stavebak` key is missing.

### 2. Mark as non-removable (optional)

In the MCP settings UI, the stavebak server could be shown with a lock icon or "built-in" badge. User can disable but not delete it.

### 3. Verify MCP connectivity

On app startup or settings panel load, do a health check to `https://stavebak.cz/mcp` and show green/red status indicator.

### 4. Welcome screen

On first launch, show a brief onboarding:
- "Stavebak is ready. Your AI assistant for Czech building permits."
- "MCP server is connected. Start a conversation to begin."
- Link to stavebak.cz for documentation
