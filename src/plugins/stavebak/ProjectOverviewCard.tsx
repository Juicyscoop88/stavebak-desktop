import { useEffect } from 'react'
import { ArrowRight, Warning } from '@phosphor-icons/react'
import { onFileChange } from '../../lib/tauri-bridge'
import { useFileStore } from '../../stores/fileStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStavebakStore, PROJECT_FILE, phaseLabel, runAction, MIGRATE_ACTION, actionTitle } from './store'

/** Pinned summary above the file tree: phase, progress, next step, expiring permits. */
export default function ProjectOverviewCard() {
  const dir = useSettingsStore((s) => s.workingDirectory)
  if (!dir) return null
  return <Card dir={dir} />
}

function Card({ dir }: { dir: string }) {
  const { status, guide, load } = useStavebakStore()
  const selectFile = useFileStore((s) => s.selectFile)
  const selectedFile = useFileStore((s) => s.selectedFile)
  const filePath = `${dir}/${PROJECT_FILE}`

  useEffect(() => {
    load(dir)
    const unlisten = onFileChange((event) => {
      if (event.paths.some((p) => p.endsWith(`/${PROJECT_FILE}`))) load(dir)
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [dir, load])

  if (status === 'idle' || (status === 'loading' && !guide)) {
    return <div className="mx-2 mt-2 h-[156px] rounded-xl bg-bg-secondary/60" />
  }

  // No project yet: the chat area shows the setup form, nothing to pin here
  if (status === 'missing') return null

  if (status === 'error' || !guide) {
    return (
      <button
        onClick={() => load(dir)}
        className="mx-2 mt-2 px-3 py-2.5 rounded-lg border border-border-subtle w-[calc(100%-16px)]
          text-left hover:bg-bg-secondary cursor-pointer"
      >
        <div className="text-sm font-medium text-text-primary truncate">Projekt</div>
        <div className="text-xs text-text-muted mt-0.5">Stav teď nejde načíst. Zkusit znovu</div>
      </button>
    )
  }

  const next = guide.nextActions[0]
  const missing = Object.keys(next?.parameters ?? {}).length
  const urgent = [...guide.expiring].sort((a, b) => a.daysLeft - b.daysLeft)[0]
  const active = selectedFile === filePath

  // Progress within the current phase, not across the whole life cycle (15 steps up to use is discouraging)
  const phases = guide.phases ?? [{ id: guide.currentPhase, label: phaseLabel(guide, guide.currentPhase) }]
  const phaseIndex = Math.max(0, phases.findIndex((p) => p.id === guide.currentPhase))
  const stepsOf = (phase: string) => guide.steps.filter((s) => s.phase === phase && !s.optional)
  const phaseSteps = stepsOf(guide.currentPhase)
  const phaseDone = phaseSteps.filter((s) => s.status === 'done').length

  return (
    <button
      onClick={() => selectFile(filePath)}
      title="Otevřít přehled projektu"
      className={`mx-2 mt-2 p-3 rounded-xl border w-[calc(100%-16px)] text-left cursor-pointer
        ${active ? 'border-border bg-bg-secondary' : 'border-border-subtle hover:bg-bg-secondary'}`}
    >
      <div className="text-sm font-medium text-text-primary line-clamp-2">
        {guide.projectName ?? guide.buildingType.label}
      </div>
      <div className="text-xs text-text-tertiary line-clamp-2">
        {guide.buildingType.label} · {guide.category.label.toLowerCase()}
      </div>

      {/* Phases of the project as segments: done, current (filled by its steps), ahead */}
      <div className="flex gap-1 mt-3" aria-hidden>
        {phases.map((p, i) => {
          const steps = stepsOf(p.id)
          const fill = i < phaseIndex ? 1 : i > phaseIndex ? 0
            : steps.length ? steps.filter((s) => s.status === 'done').length / steps.length : 0
          return (
            <div key={p.id} title={p.label}
              className={`flex-1 h-1 rounded-full overflow-hidden ${i === phaseIndex ? 'bg-accent/25' : 'bg-bg-tertiary'}`}>
              <div className={`h-full ${i === phaseIndex ? 'bg-accent' : 'bg-text-primary'}`}
                style={{ width: `${fill * 100}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs mt-1.5">
        <span className="text-text-primary">
          {phaseLabel(guide, guide.currentPhase)}
          <span className="text-text-tertiary"> · fáze {phaseIndex + 1} z {phases.length}</span>
        </span>
        {phaseSteps.length > 0 && (
          <span className="text-text-tertiary tabular-nums flex-shrink-0">
            {phaseDone} z {phaseSteps.length} kroků
          </span>
        )}
      </div>

      {next && (
        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-border-subtle">
          <div className="flex-1 min-w-0">
            <div className="text-2xs text-text-tertiary">
              Teď{next.kindLabel ? ` · ${next.kindLabel}` : ''}
            </div>
            <div className="text-sm text-text-primary line-clamp-2">{actionTitle(next)}</div>
            {missing > 0 && (
              <div className="text-xs text-text-muted">
                {missing === 1 ? 'chybí 1 údaj' : missing < 5 ? `chybí ${missing} údaje` : `chybí ${missing} údajů`}
              </div>
            )}
          </div>
          <ArrowRight size={14} className="text-text-tertiary flex-shrink-0" />
        </div>
      )}
      {guide.format?.hint && (
        <div
          role="button"
          onClick={(e) => { e.stopPropagation(); runAction(MIGRATE_ACTION) }}
          className="text-xs text-text-muted mt-2 underline decoration-border underline-offset-2 hover:text-text-primary"
        >
          Starší formát, stav nemusí sedět. Převést
        </div>
      )}
      {urgent && (
        <div className="flex items-center gap-1 text-xs text-warning mt-1">
          <Warning size={11} weight="bold" className="flex-shrink-0" />
          <span className="truncate">
            {urgent.label}: {urgent.daysLeft < 0 ? 'propadlo' : `${urgent.daysLeft} dní`}
          </span>
        </div>
      )}
    </button>
  )
}
