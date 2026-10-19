import type { PluginManifest } from '../types'

export const manifest: PluginManifest = {
  id: 'stavebak',
  name: 'Stavebak DSP',
  mcpServer: 'stavebak',

  panels: [
    {
      id: 'stav-new-project',
      label: 'Nový projekt',
      slot: 'new-project',
      priority: 100,
      component: () => import('./NewProjectForm'),
    },
    {
      id: 'stav-chat-empty',
      label: 'Začátek projektu',
      slot: 'chat-empty',
      priority: 100,
      component: () => import('./ChatEmptyState'),
    },
    {
      id: 'stav-overview-card',
      label: 'Přehled projektu',
      slot: 'sidebar-top',
      priority: 100,
      component: () => import('./ProjectOverviewCard'),
    },
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
      requiredTools: ['find_suppliers'],
      component: () => import('./panels/ServicesPanel'),
    },
  ],

  fileRenderers: [
    { fileName: 'stavebak.json', component: () => import('./ProjectOverview') },
  ],
}
