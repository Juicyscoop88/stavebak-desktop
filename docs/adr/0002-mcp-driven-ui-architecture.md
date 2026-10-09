# ADR-0002: MCP-Driven UI Architecture

**Status:** Accepted  
**Date:** 2026-10-08  
**Context:** Redesign stavebak-desktop from generic CC wrapper to domain-aware app for construction engineers, with architecture that supports future MCP servers driving custom UI.

---

## Decision

Two-layer UI extension system:

1. **MCP Apps (standard)** — inline widgets in chat via `@modelcontextprotocol/ext-apps`
2. **Panel Plugins (ours)** — sidebar/workspace panels via a client-side plugin registry

Core never imports from plugins. Deleting a plugin folder = app works as generic CC wrapper.

---

## Architecture

```
src/
  core/                          # CC wrapper — MCP-agnostic
    components/
      layout/
        AppShell.tsx             # 3-column: left slot | chat | right slot
        PanelSlot.tsx            # Renders whatever PanelRegistry assigns
      chat/
        ChatPanel.tsx
        McpAppFrame.tsx          # NEW — iframe host for MCP Apps standard
        ...existing
    stores/
      ...existing
    lib/
      panel-registry.ts         # Singleton registry, no MCP knowledge
      mcp-app-bridge.ts         # @modelcontextprotocol/ext-apps/app-bridge

  plugins/                       # MCP-specific UI — each folder = one MCP server
    registry.ts                  # Auto-discovers + registers all plugin manifests
    types.ts                     # Shared interfaces

    stavebak/
      manifest.ts
      panels/
        ProjectStatusPanel.tsx
        DocumentsPanel.tsx
        CADPreviewPanel.tsx
        ServicesPanel.tsx
      store.ts                   # Zustand slice for stavebak-specific state
      mcp-client.ts              # Direct MCP connection to stavebak server
```

---

## Layer 1: MCP Apps (Standard Inline Widgets)

### What it is

The official MCP extension (`@modelcontextprotocol/ext-apps`, spec 2026-01). MCP servers declare HTML UI via `ui://` resources. Tool results reference them via `_meta.ui.resourceUri`. The host renders them in sandboxed iframes.

### Integration point

`McpAppFrame.tsx` — a new component rendered inside `MessageBubble.tsx` when a tool result contains `_meta.ui.resourceUri`.

```tsx
// core/components/chat/McpAppFrame.tsx

interface McpAppFrameProps {
  resourceUri: string      // e.g. "ui://stavebak/project-status"
  serverName: string       // MCP server key from config
  toolResult: unknown      // data passed to the iframe
  maxHeight?: number
}

export function McpAppFrame({ resourceUri, serverName, toolResult, maxHeight = 400 }: McpAppFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    // @modelcontextprotocol/ext-apps/app-bridge handles:
    // - loading HTML from MCP resource
    // - PostMessageTransport for bidirectional JSON-RPC
    // - sandboxing (no top-navigation, no same-origin)
    const bridge = createAppBridge({
      iframe: iframeRef.current!,
      serverName,
      resourceUri,
      initialData: toolResult,
      onToolCall: async (toolName, args) => {
        // Route tool calls back through the CLI session
        // (user sees permission prompt as normal)
        return chatStore.getState().requestToolCall(serverName, toolName, args)
      },
    })
    return () => bridge.dispose()
  }, [resourceUri])

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      style={{ width: '100%', maxHeight, border: 'none', borderRadius: 8 }}
    />
  )
}
```

### Detection in stream

In `useStreamProcessor.ts`, when processing `tool_result` events:

```typescript
if (result._meta?.ui?.resourceUri) {
  // Attach MCP App frame metadata to the message
  message.mcpApp = {
    resourceUri: result._meta.ui.resourceUri,
    serverName: result._meta.ui.serverName,
    data: result.content,
  }
}
```

`MessageBubble.tsx` renders `<McpAppFrame>` when `message.mcpApp` is present.

### Server side (stavebak.cz)

The stavebak MCP server registers `ui://` resources for its tools:

```typescript
// On stavebak.cz server — example for guide tool
server.tool("guide", schema, async (params) => {
  const result = computeGuide(params)
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    _meta: {
      ui: {
        resourceUri: "ui://stavebak/project-progress",
        // The HTML template is registered as an MCP resource
      }
    }
  }
})

server.resource("ui://stavebak/project-progress", {
  mimeType: "text/html;profile=mcp-app",
  // Returns self-contained HTML that renders a progress checklist
  // Uses @modelcontextprotocol/ext-apps SDK for host communication
})
```

---

## Layer 2: Panel Plugins (Our Extension)

### Plugin Manifest

```typescript
// plugins/types.ts

export interface PanelDefinition {
  id: string                              // unique across all plugins
  label: string                           // shown in panel dropdown
  icon?: string                           // optional icon identifier
  slot: 'left' | 'right'                  // preferred panel slot
  priority: number                        // higher = shown by default (0-100)
  component: () => Promise<{ default: ComponentType }>  // lazy import
  requiredTools?: string[]                // only show if MCP server has these
}

export interface PluginManifest {
  id: string                              // matches folder name
  name: string                            // human-readable
  mcpServer: string                       // key in mcpServers config
  panels: PanelDefinition[]
}
```

### Panel Registry

```typescript
// core/lib/panel-registry.ts

type PanelEntry = PanelDefinition & { pluginId: string }

class PanelRegistry {
  private panels = new Map<string, PanelEntry>()
  private listeners = new Set<() => void>()

  register(pluginId: string, panels: PanelDefinition[]) {
    for (const panel of panels) {
      this.panels.set(panel.id, { ...panel, pluginId })
    }
    this.notify()
  }

  unregister(pluginId: string) {
    for (const [id, entry] of this.panels) {
      if (entry.pluginId === pluginId) this.panels.delete(id)
    }
    this.notify()
  }

  getPanelsForSlot(slot: 'left' | 'right'): PanelEntry[] {
    return [...this.panels.values()]
      .filter(p => p.slot === slot)
      .sort((a, b) => b.priority - a.priority)
  }

  getPanel(id: string): PanelEntry | undefined {
    return this.panels.get(id)
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    this.listeners.forEach(fn => fn())
  }
}

export const panelRegistry = new PanelRegistry()
```

### PanelSlot Component

```tsx
// core/components/layout/PanelSlot.tsx

interface PanelSlotProps {
  slot: 'left' | 'right'
  activePanelId: string | null
  onPanelChange: (id: string | null) => void
}

export function PanelSlot({ slot, activePanelId, onPanelChange }: PanelSlotProps) {
  const [panels, setPanels] = useState<PanelEntry[]>([])
  const [ActiveComponent, setActiveComponent] = useState<ComponentType | null>(null)

  useEffect(() => {
    return panelRegistry.subscribe(() => {
      setPanels(panelRegistry.getPanelsForSlot(slot))
    })
  }, [slot])

  // Lazy-load active panel component
  useEffect(() => {
    if (!activePanelId) { setActiveComponent(null); return }
    const panel = panelRegistry.getPanel(activePanelId)
    if (!panel) return
    panel.component().then(mod => setActiveComponent(() => mod.default))
  }, [activePanelId])

  // Also include core panels (files, skills, projects) — they register
  // themselves the same way via panelRegistry in core init

  return (
    <div className="panel-slot">
      {/* Dropdown to switch views */}
      <PanelDropdown
        panels={panels}
        activeId={activePanelId}
        onChange={onPanelChange}
      />

      {/* Render active panel */}
      <div className="panel-content">
        {ActiveComponent ? <ActiveComponent /> : <EmptyPanelHint slot={slot} />}
      </div>
    </div>
  )
}
```

### AppShell Integration

```tsx
// core/components/layout/AppShell.tsx (modified)

export function AppShell() {
  const { leftPanelId, rightPanelId, setLeftPanel, setRightPanel,
          leftWidth, rightWidth } = useSettingsStore()

  return (
    <div className="app-shell">
      {/* Left panel — resizable, collapsible */}
      <ResizablePanel width={leftWidth} minWidth={200} maxWidth={450}
                      collapsed={!leftPanelId}>
        <PanelSlot slot="left" activePanelId={leftPanelId}
                   onPanelChange={setLeftPanel} />
      </ResizablePanel>

      {/* Chat — always centered, max-width constrained */}
      <main className="chat-column">
        <ChatPanel />
      </main>

      {/* Right panel — resizable, collapsible */}
      <ResizablePanel width={rightWidth} minWidth={200} maxWidth={600}
                      collapsed={!rightPanelId}>
        <PanelSlot slot="right" activePanelId={rightPanelId}
                   onPanelChange={setRightPanel} />
      </ResizablePanel>
    </div>
  )
}
```

### Core Panels as Plugins

Existing panels (Files, Skills, Projects, Conversations) also register via PanelRegistry — they're just "built-in plugins":

```typescript
// core/init.ts — runs on app start

import { panelRegistry } from './lib/panel-registry'

// Built-in panels use the same registry
panelRegistry.register('core', [
  {
    id: 'conversations',
    label: 'Konverzace',
    slot: 'left',
    priority: 100,    // highest — default left panel
    component: () => import('../components/conversations/ConversationList'),
  },
  {
    id: 'files',
    label: 'Soubory',
    slot: 'right',
    priority: 50,
    component: () => import('../components/files/FileExplorer'),
  },
  {
    id: 'skills',
    label: 'Skills',
    slot: 'right',
    priority: 40,
    component: () => import('../components/skills/SkillsPanel'),
  },
])
```

### Plugin Auto-Discovery

```typescript
// plugins/registry.ts

import { panelRegistry } from '../core/lib/panel-registry'
import { useMcpStore } from '../stores/mcpStore'

// Static imports — each plugin folder is known at build time.
// Dynamic loading from arbitrary MCP servers is NOT supported
// (that's what MCP Apps / iframes are for).
const pluginModules = import.meta.glob('./*/manifest.ts', { eager: true })

export function registerPlugins() {
  const configuredServers = useMcpStore.getState().servers

  for (const [path, mod] of Object.entries(pluginModules)) {
    const manifest = (mod as { manifest: PluginManifest }).manifest
    const serverConfig = configuredServers[manifest.mcpServer]

    if (!serverConfig) continue  // MCP server not configured — skip plugin

    // Optionally: connect to MCP server, verify requiredTools exist
    // For now: trust that if the server is configured, the plugin applies

    panelRegistry.register(manifest.id, manifest.panels)
  }
}
```

---

## Layer 2b: Plugin MCP Client (Direct Connection)

Panel plugins need data from MCP servers independently of the chat/CLI. Each plugin gets its own MCP client:

```typescript
// plugins/stavebak/mcp-client.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let client: Client | null = null

export async function getStavebakClient(): Promise<Client> {
  if (client) return client

  client = new Client({ name: 'stavebak-desktop', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL('https://stavebak.cz/mcp')
  )
  await client.connect(transport)
  return client
}

// Typed wrappers for stavebak tools
export async function getProjectStatus(projectId: string) {
  const c = await getStavebakClient()
  return c.callTool({ name: 'guide', arguments: { projectId } })
}

export async function listProjects() {
  const c = await getStavebakClient()
  return c.callTool({ name: 'list_projects', arguments: {} })
}
```

### Plugin Store

```typescript
// plugins/stavebak/store.ts

import { create } from 'zustand'
import { listProjects, getProjectStatus } from './mcp-client'

interface StavebakState {
  projects: Project[]
  activeProjectId: string | null
  status: ProjectStatus | null
  loading: boolean

  fetchProjects: () => Promise<void>
  fetchStatus: (projectId: string) => Promise<void>
  setActiveProject: (id: string) => void
}

export const useStavebakStore = create<StavebakState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  status: null,
  loading: false,

  fetchProjects: async () => {
    set({ loading: true })
    const result = await listProjects()
    set({ projects: JSON.parse(result.content[0].text), loading: false })
  },

  fetchStatus: async (projectId) => {
    const result = await getProjectStatus(projectId)
    set({ status: JSON.parse(result.content[0].text) })
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id })
    get().fetchStatus(id)
  },
}))
```

---

## Stavebak Plugin — Panel Manifest

```typescript
// plugins/stavebak/manifest.ts

import type { PluginManifest } from '../types'

export const manifest: PluginManifest = {
  id: 'stavebak',
  name: 'Stavebak DSP',
  mcpServer: 'stavebak',

  panels: [
    {
      id: 'stav-documents',
      label: 'Dokumenty',
      icon: 'file-text',
      slot: 'left',
      priority: 90,
      requiredTools: ['validate_extraction'],
      component: () => import('./panels/DocumentsPanel'),
    },
    {
      id: 'stav-project-status',
      label: 'Stav projektu',
      icon: 'list-checks',
      slot: 'right',
      priority: 90,
      requiredTools: ['guide'],
      component: () => import('./panels/ProjectStatusPanel'),
    },
    {
      id: 'stav-cad-preview',
      label: '3D Náhled',
      icon: 'box',
      slot: 'right',
      priority: 30,
      component: () => import('./panels/CADPreviewPanel'),
    },
    {
      id: 'stav-services',
      label: 'Služby',
      icon: 'phone',
      slot: 'left',
      priority: 20,
      requiredTools: ['get_sluzby'],
      component: () => import('./panels/ServicesPanel'),
    },
  ],
}
```

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│                     User in Chat                         │
│                         │                                │
│                         ▼                                │
│              CLI Session (stdin/stdout)                   │
│                    │          │                           │
│                    ▼          ▼                           │
│   Stream events (text,    Tool results with              │
│   thinking, tool_use)     _meta.ui.resourceUri           │
│         │                       │                        │
│         ▼                       ▼                        │
│   MessageBubble            McpAppFrame                   │
│   (core chat)              (MCP Apps standard)           │
│                            iframe sandbox                │
│                                                          │
│  ─── independent of chat ───                             │
│                                                          │
│   Plugin MCP Client ──→ stavebak.cz/mcp (direct)        │
│         │                                                │
│         ▼                                                │
│   stavebakStore ──→ ProjectStatusPanel (right slot)      │
│                 ──→ DocumentsPanel (left slot)            │
│                 ──→ CADPreviewPanel (right slot)          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Order

### Phase 1: Panel Infrastructure
1. Create `core/lib/panel-registry.ts`
2. Create `core/components/layout/PanelSlot.tsx`
3. Refactor `AppShell.tsx` — replace hardcoded sidebar/secondary with PanelSlots
4. Migrate existing panels (Conversations, Files, Skills) to register via PanelRegistry
5. Add panel dropdown + drag-to-resize on both slots
6. Constrain chat to max-width centered

### Phase 2: Stavebak Plugin (Panels)
1. Create `plugins/types.ts` + `plugins/registry.ts`
2. Create `plugins/stavebak/manifest.ts` + `mcp-client.ts` + `store.ts`
3. Implement `ProjectStatusPanel` (reads from `guide` tool)
4. Implement `DocumentsPanel` (upload + `validate_extraction` status)
5. Implement `ServicesPanel` (reads from `get_sluzby`)

### Phase 3: MCP Apps Integration
1. Add `@modelcontextprotocol/ext-apps` dependency
2. Create `core/components/chat/McpAppFrame.tsx`
3. Detect `_meta.ui.resourceUri` in stream processor
4. Render inline iframes in MessageBubble
5. On stavebak.cz: add `ui://` resources for guide, regulativy, classification results

### Phase 4: CAD Preview
1. Add `@thatopen/engine_web-ifc` + Three.js dependencies
2. Implement `CADPreviewPanel` — IFC viewer
3. Add DXF support via `three-dxf`
4. Wire file upload → preview pipeline

---

## Rules

- **Core never imports from `plugins/`**. The only bridge is `PanelRegistry`.
- **Plugins never modify core components**. They register panels and read from their own MCP client.
- **MCP Apps (iframes) are for server-controlled UI**. Panel plugins are for client-controlled UI.
- **One plugin = one MCP server**. No plugin spans multiple servers.
- **Plugins are build-time static**. We don't load arbitrary code from MCP servers at runtime (security). Dynamic UI from servers goes through MCP Apps iframes.
- **Plugin state is isolated**. Each plugin has its own Zustand store. No cross-plugin imports.
