import { useEffect, useState, useCallback } from 'react';
import { ArrowsClockwise, Plus, HardDrives, Lock, PencilSimple, Trash } from '@phosphor-icons/react';
import { useMcpStore, BUILTIN_SERVER_NAME } from '../../stores/mcpStore';
import type { McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';

export function McpTab() {
  const t = useT();
  const servers = useMcpStore((s) => s.servers);
  const isLoading = useMcpStore((s) => s.isLoading);
  const fetchServers = useMcpStore((s) => s.fetchServers);
  const addServer = useMcpStore((s) => s.addServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const deleteServer = useMcpStore((s) => s.deleteServer);
  const editingServer = useMcpStore((s) => s.editingServer);
  const isAdding = useMcpStore((s) => s.isAdding);
  const setEditing = useMcpStore((s) => s.setEditing);
  const setAdding = useMcpStore((s) => s.setAdding);
  const healthStatus = useMcpStore((s) => s.healthStatus);
  const ensureDefaultServer = useMcpStore((s) => s.ensureDefaultServer);
  const checkHealth = useMcpStore((s) => s.checkHealth);

  useEffect(() => {
    ensureDefaultServer().then(() => fetchServers());
    checkHealth();
  }, [fetchServers, ensureDefaultServer, checkHealth]);

  const handleDelete = useCallback(async (name: string) => {
    if (confirm(t('mcp.confirmDelete'))) {
      await deleteServer(name);
    }
  }, [deleteServer, t]);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary">
            {t('mcp.title')}
          </h3>
          <span className="text-xs text-text-tertiary">{servers.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchServers()}
            className="p-1.5 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.refresh')}
          >
            <ArrowsClockwise size={14} weight="light" />
          </button>
          <button
            onClick={() => setAdding(true)}
            className="p-1.5 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.add')}
          >
            <Plus size={14} weight="light" />
          </button>
        </div>
      </div>

      {/* Content — always expanded */}
      <div className="space-y-2">
        {/* Add form */}
        {isAdding && (
          <McpServerForm
            onSave={async (name, config) => { await addServer(name, config); }}
            onCancel={() => setAdding(false)}
            t={t}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 && !isAdding ? (
          <p className="text-sm text-text-tertiary text-center py-6">
            {t('mcp.noServers')}
          </p>
        ) : (
          servers.map((server) => (
            editingServer === server.name ? (
              <McpServerForm
                key={server.name}
                server={server}
                onSave={async (name, config) => {
                  await updateServer(server.name, name, config);
                }}
                onCancel={() => setEditing(null)}
                t={t}
              />
            ) : (
              <McpServerCardCompact
                key={server.name}
                server={server}
                onEdit={() => setEditing(server.name)}
                onDelete={() => handleDelete(server.name)}
                healthStatus={server.name === BUILTIN_SERVER_NAME ? healthStatus : undefined}
                t={t}
              />
            )
          ))
        )}
      </div>
    </div>
  );
}

/* Compact server card */
function McpServerCardCompact({
  server,
  onEdit,
  onDelete,
  healthStatus,
  t,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
  healthStatus?: 'unknown' | 'checking' | 'ok' | 'error';
  t: (key: string) => string;
}) {
  const isBuiltin = server.name === BUILTIN_SERVER_NAME;
  const envCount = Object.keys(server.config.env).length;
  const display = server.config.url || [server.config.command, ...server.config.args].join(' ');

  return (
    <div className="px-4 py-3 rounded-lg transition-smooth group border
      border-border-subtle hover:bg-bg-secondary">
      {/* Name + type + actions */}
      <div className="flex items-center gap-2">
        <HardDrives size={12} weight="light" className="text-text-tertiary shrink-0" />
        <span className="text-sm font-medium truncate flex-1 text-text-primary">
          {server.name}
        </span>
        {isBuiltin && (
          <span className="shrink-0 px-2 py-0.5 text-xs rounded-md
            bg-accent/15 text-accent font-medium flex items-center gap-1">
            <Lock size={10} weight="light" />
            {t('mcp.builtin')}
          </span>
        )}
        {isBuiltin && healthStatus && (
          <span className={`shrink-0 w-2 h-2 rounded-full ${
            healthStatus === 'ok' ? 'bg-green-500' :
            healthStatus === 'error' ? 'bg-red-500' :
            healthStatus === 'checking' ? 'bg-yellow-500 animate-pulse' :
            'bg-gray-500'
          }`} title={t(`mcp.health.${healthStatus}`)} />
        )}
        <span className="shrink-0 px-2 py-0.5 text-xs rounded-md
          bg-blue-500/15 text-blue-400 font-medium">
          {server.config.type}
        </span>
        {!isBuiltin && (
          <button
            onClick={onEdit}
            className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
              hover:bg-bg-tertiary transition-smooth text-text-tertiary"
            title={t('mcp.edit')}
          >
            <PencilSimple size={12} weight="light" />
          </button>
        )}
        {!isBuiltin && (
          <button
            onClick={onDelete}
            className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
              hover:bg-red-500/10 transition-smooth text-text-tertiary hover:text-red-500"
            title={t('mcp.delete')}
          >
            <Trash size={12} weight="light" />
          </button>
        )}
      </div>
      {/* Command or URL */}
      <p className="text-xs text-text-muted mt-1 font-mono truncate pl-5">
        {display}
      </p>
      {envCount > 0 && (
        <p className="text-xs text-text-tertiary mt-0.5 pl-5">
          {envCount} {t('mcp.envCount')}
        </p>
      )}
    </div>
  );
}

/* Add/Edit form for MCP servers */
function McpServerForm({
  server,
  onSave,
  onCancel,
  t,
}: {
  server?: McpServer;
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(server?.name || '');
  const [command, setCommand] = useState(server?.config.command || '');
  const [argsText, setArgsText] = useState(server?.config.args.join('\n') || '');
  const [envText, setEnvText] = useState(
    server?.config.env
      ? Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join('\n')
      : ''
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !command.trim()) return;
    setIsSaving(true);
    try {
      const args = argsText.split('\n').map((s) => s.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      envText.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      });
      await onSave(name.trim(), { command: command.trim(), args, env, type: 'stdio' });
    } finally {
      setIsSaving(false);
    }
  }, [name, command, argsText, envText, onSave]);

  const inputClass = `w-full px-3 py-2 text-sm bg-bg-chat border border-border-subtle
    rounded-lg outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary`;

  return (
    <div className="px-4 py-3 rounded-lg border border-accent/30 bg-accent/5 space-y-3">
      <div>
        <label className="text-xs text-text-muted">
          {t('mcp.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mcp.namePlaceholder')}
          className={inputClass}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted">
          {t('mcp.command')}
        </label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t('mcp.commandPlaceholder')}
          className={inputClass}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted">
          {t('mcp.args')}
        </label>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder={t('mcp.argsHint')}
          rows={2}
          className={`${inputClass} resize-none font-mono`}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted">
          {t('mcp.env')}
        </label>
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={t('mcp.envHint')}
          rows={2}
          className={`${inputClass} resize-none font-mono`}
        />
      </div>
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !command.trim() || isSaving}
          className="flex-1 px-4 py-2 text-sm font-medium bg-accent text-text-inverse rounded-lg
            hover:bg-accent-hover disabled:opacity-40 transition-smooth"
        >
          {isSaving ? '...' : t('mcp.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-smooth"
        >
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}
