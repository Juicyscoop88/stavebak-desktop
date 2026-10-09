import { useEffect } from 'react'
import { useStavebakStore } from '../store'

export default function ProjectStatusPanel() {
  const { status, loading, activeProjectId, projects, fetchProjects, setActiveProject } = useStavebakStore()

  useEffect(() => {
    if (projects.length === 0) fetchProjects()
  }, [projects.length, fetchProjects])

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">Stav projektu</h3>

      {projects.length > 0 && (
        <select
          value={activeProjectId ?? ''}
          onChange={e => setActiveProject(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-bg-secondary text-text-primary text-sm
            border border-border-subtle"
        >
          <option value="" disabled>Vyberte projekt...</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {loading && (
        <p className="text-xs text-text-muted">Načítání...</p>
      )}

      {status && !loading && (
        <pre className="text-xs text-text-secondary bg-bg-secondary rounded-lg p-3 overflow-auto max-h-[60vh]">
          {JSON.stringify(status, null, 2)}
        </pre>
      )}

      {!status && !loading && activeProjectId && (
        <p className="text-xs text-text-muted">Žádná data.</p>
      )}
    </div>
  )
}
