import { useEffect, useState, useCallback } from 'react';
import { HardDrives, ArrowsClockwise, Plus, PencilSimple, Trash, SpinnerGap } from '@phosphor-icons/react';
import { useMcpStore, BUILTIN_SERVER_NAME } from '../../stores/mcpStore';
import type { McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';

export function McpPanel() {
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

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleDelete = useCallback(async (name: string) => {
    if (confirm(t('mcp.confirmDelete'))) {
      await deleteServer(name);
    }
  }, [deleteServer, t]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2
        border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrives size={12} weight="light" className="text-accent flex-shrink-0" />
          <span className="text-xs font-semibold text-text-primary">
            {t('mcp.title')}
          </span>
          <span className="text-xs text-text-muted flex-shrink-0">
            {servers.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchServers()}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.refresh')}
          >
            <ArrowsClockwise size={12} weight="light" />
          </button>
          <button
            onClick={() => setAdding(true)}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.add')}
          >
            <Plus size={12} weight="light" />
          </button>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Add form at top */}
        {isAdding && (
          <McpServerForm
            onSave={async (name, config) => {
              await addServer(name, config);
            }}
            onCancel={() => setAdding(false)}
            t={t}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerGap size={20} weight="light" className="animate-spin text-accent" />
          </div>
        ) : servers.length === 0 && !isAdding ? (
          <div className="flex flex-col items-center justify-center py-8
            text-text-tertiary text-xs gap-2">
            <HardDrives size={32} weight="light" className="text-text-tertiary/40" />
            <p className="text-xs text-text-tertiary leading-relaxed">
              {t('mcp.noServers')}
            </p>
          </div>
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
              <McpServerCard
                key={server.name}
                server={server}
                onEdit={() => setEditing(server.name)}
                onDelete={() => handleDelete(server.name)}
                t={t}
              />
            )
          ))
        )}
      </div>
    </div>
  );
}

/* Server card */
function McpServerCard({
  server,
  onEdit,
  onDelete,
  t,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  const isBuiltin = server.name === BUILTIN_SERVER_NAME;
  const envCount = Object.keys(server.config.env).length;
  const display = server.config.url || [server.config.command, ...server.config.args].join(' ');

  return (
    <div className="mx-1.5 mb-1 px-2.5 py-2 rounded-lg
      transition-smooth group border border-transparent
      hover:bg-bg-secondary hover:border-border-subtle">
      {/* Row 1: Name + type badge + actions */}
      <div className="flex items-center gap-1.5">
        <HardDrives size={10} weight="light" className="text-text-tertiary shrink-0" />
        <span className="text-sm font-medium truncate flex-1 text-text-primary">
          {server.name}
        </span>
        {isBuiltin && (
          <span className="shrink-0 px-1.5 py-0.5 text-[9px] rounded-md
            bg-accent/15 text-accent font-medium">
            {t('mcp.builtin')}
          </span>
        )}
        <span className="shrink-0 px-1.5 py-0.5 text-[9px] rounded-md
          bg-blue-500/15 text-blue-400 font-medium">
          {server.config.type}
        </span>
        {!isBuiltin && (
          <button
            onClick={onEdit}
            className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
              hover:bg-bg-tertiary transition-smooth text-text-tertiary"
            title={t('mcp.edit')}
          >
            <PencilSimple size={11} weight="light" />
          </button>
        )}
        {!isBuiltin && (
          <button
            onClick={onDelete}
            className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
              hover:bg-red-500/10 transition-smooth text-text-tertiary hover:text-red-500"
            title={t('mcp.delete')}
          >
            <Trash size={11} weight="light" />
          </button>
        )}
      </div>

      {/* Row 2: Command or URL in monospace */}
      <p className="text-xs text-text-muted mt-1 font-mono truncate pl-4">
        {display}
      </p>

      {/* Row 3: Env var count */}
      {envCount > 0 && (
        <p className="text-xs text-text-tertiary mt-0.5 pl-4">
          {envCount} {t('mcp.envCount')}
        </p>
      )}
    </div>
  );
}

/* Add/Edit form */
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

  const inputClass = `w-full px-2 py-1 text-xs bg-bg-chat border border-border-subtle
    rounded-lg outline-none focus:border-accent text-text-primary`;

  return (
    <div className="mx-1.5 mb-1 px-2.5 py-2 rounded-lg border border-accent/30
      bg-accent/5 space-y-2">
      {/* Name */}
      <div>
        <label className="text-xs text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mcp.namePlaceholder')}
          className={inputClass}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>

      {/* Command */}
      <div>
        <label className="text-xs text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.command')}
        </label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t('mcp.commandPlaceholder')}
          className={inputClass}
        />
      </div>

      {/* Args */}
      <div>
        <label className="text-xs text-text-tertiary font-medium uppercase tracking-wider">
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

      {/* Env */}
      <div>
        <label className="text-xs text-text-tertiary font-medium uppercase tracking-wider">
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

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !command.trim() || isSaving}
          className="flex-1 px-2 py-1 text-xs bg-accent text-text-inverse rounded-lg
            hover:bg-accent-hover disabled:opacity-40 transition-smooth"
        >
          {isSaving ? '...' : t('mcp.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-smooth"
        >
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}
