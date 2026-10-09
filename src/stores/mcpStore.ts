import { create } from 'zustand';
import { bridge } from '../lib/tauri-bridge';

// --- Types ---

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  type: string;
  url?: string;
}

export const BUILTIN_SERVER_NAME = 'stavebak';
export const BUILTIN_SERVER_CONFIG = {
  type: 'streamable-http',
  url: 'https://stavebak.cz/mcp',
} as const;

export interface McpServer {
  name: string;
  config: McpServerConfig;
}

interface McpState {
  servers: McpServer[];
  isLoading: boolean;
  editingServer: string | null;
  isAdding: boolean;
  healthStatus: 'unknown' | 'checking' | 'ok' | 'error';

  fetchServers: () => Promise<void>;
  ensureDefaultServer: () => Promise<void>;
  checkHealth: () => Promise<void>;
  addServer: (name: string, config: McpServerConfig) => Promise<void>;
  updateServer: (oldName: string, newName: string, config: McpServerConfig) => Promise<void>;
  deleteServer: (name: string) => Promise<void>;
  setEditing: (name: string | null) => void;
  setAdding: (adding: boolean) => void;
}

// --- Helpers ---

async function readClaudeJson(): Promise<Record<string, unknown>> {
  const home = await bridge.getHomeDir();
  const path = `${home}/.claude.json`;
  try {
    const content = await bridge.readFileContent(path);
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeClaudeJson(data: Record<string, unknown>): Promise<void> {
  const home = await bridge.getHomeDir();
  const path = `${home}/.claude.json`;
  await bridge.writeFileContent(path, JSON.stringify(data, null, 2));
}

/** Detect and flatten double-nested mcpServers.mcpServers structure (Issue #33). */
function normalizeMcpServers(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  // If the only (or first) key is "mcpServers" and its value looks like a server map,
  // the user has a double-nested config — unwrap one level.
  if ('mcpServers' in raw && typeof raw.mcpServers === 'object' && raw.mcpServers !== null) {
    console.warn(
      '[mcpStore] WARNING: detected double-nested mcpServers.mcpServers in ~/.claude.json, auto-flattening',
    );
    return raw.mcpServers as Record<string, unknown>;
  }
  return raw;
}

function parseServers(mcpServers: Record<string, unknown> | undefined): McpServer[] {
  const normalized = normalizeMcpServers(mcpServers);
  if (!normalized || typeof normalized !== 'object') return [];
  return Object.entries(normalized).map(([name, raw]) => {
    const cfg = raw as Record<string, unknown>;
    return {
      name,
      config: {
        command: (cfg.command as string) || '',
        args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
        env: (cfg.env as Record<string, string>) || {},
        type: (cfg.type as string) || 'stdio',
        url: (cfg.url as string) || undefined,
      },
    };
  });
}

// --- Store ---

export const useMcpStore = create<McpState>()((set) => ({
  servers: [],
  isLoading: false,
  editingServer: null,
  isAdding: false,
  healthStatus: 'unknown' as const,

  ensureDefaultServer: async () => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    if (!(BUILTIN_SERVER_NAME in mcpServers)) {
      mcpServers[BUILTIN_SERVER_NAME] = { ...BUILTIN_SERVER_CONFIG };
      json.mcpServers = mcpServers;
      await writeClaudeJson(json);
      const servers = parseServers(mcpServers);
      set({ servers });
    }
  },

  checkHealth: async () => {
    set({ healthStatus: 'checking' });
    try {
      const resp = await fetch(BUILTIN_SERVER_CONFIG.url, { method: 'HEAD', mode: 'no-cors' });
      set({ healthStatus: resp.ok || resp.type === 'opaque' ? 'ok' : 'error' });
    } catch {
      set({ healthStatus: 'error' });
    }
  },

  fetchServers: async () => {
    set({ isLoading: true });
    try {
      const json = await readClaudeJson();
      const rawMcp = json.mcpServers as Record<string, unknown> | undefined;
      // Auto-fix double-nested mcpServers.mcpServers on disk
      if (
        rawMcp &&
        typeof rawMcp === 'object' &&
        'mcpServers' in rawMcp &&
        typeof rawMcp.mcpServers === 'object'
      ) {
        json.mcpServers = rawMcp.mcpServers;
        await writeClaudeJson(json);
      }
      const servers = parseServers(json.mcpServers as Record<string, unknown> | undefined);
      set({ servers, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addServer: async (name, config) => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    mcpServers[name] = config.url
      ? { type: config.type, url: config.url }
      : {
          command: config.command,
          args: config.args,
          env: Object.keys(config.env).length > 0 ? config.env : undefined,
          type: config.type,
        };
    json.mcpServers = mcpServers;
    await writeClaudeJson(json);
    const servers = parseServers(mcpServers);
    set({ servers, isAdding: false });
  },

  updateServer: async (oldName, newName, config) => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    if (oldName !== newName) {
      delete mcpServers[oldName];
    }
    mcpServers[newName] = config.url
      ? { type: config.type, url: config.url }
      : {
          command: config.command,
          args: config.args,
          env: Object.keys(config.env).length > 0 ? config.env : undefined,
          type: config.type,
        };
    json.mcpServers = mcpServers;
    await writeClaudeJson(json);
    const servers = parseServers(mcpServers);
    set({ servers, editingServer: null });
  },

  deleteServer: async (name) => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    delete mcpServers[name];
    json.mcpServers = mcpServers;
    await writeClaudeJson(json);
    const servers = parseServers(mcpServers);
    set({ servers });
  },

  setEditing: (name) => set({ editingServer: name, isAdding: false }),
  setAdding: (adding) => set({ isAdding: adding, editingServer: null }),
}));
