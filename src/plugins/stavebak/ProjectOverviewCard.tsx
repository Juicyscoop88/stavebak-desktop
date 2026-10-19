import { useEffect } from 'react'
import { Warning } from '@phosphor-icons/react'
import { onFileChange } from '../../lib/tauri-bridge'
import { useFileStore } from '../../stores/fileStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStavebakStore, PROJECT_FILE, phaseLabel, runAction, MIGRATE_ACTION } from './store'

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
    return <div className="mx-2 mt-2 h-[92px] rounded-lg bg-bg-secondary/60" />
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

  const { done, total } = guide.progress
  const next = guide.nextActions[0]
  const urgent = [...guide.expiring].sort((a, b) => a.daysLeft - b.daysLeft)[0]
  const active = selectedFile === filePath

  return (
    <button
      onClick={() => selectFile(filePath)}
      className={`mx-2 mt-2 px-3 py-2.5 rounded-lg border w-[calc(100%-16px)] text-left cursor-pointer
        ${active ? 'border-border bg-bg-secondary' : 'border-border-subtle hover:bg-bg-secondary'}`}
    >
      <div className="text-sm font-medium text-text-primary line-clamp-2 leading-snug">
        {guide.projectName ?? guide.buildingType.label}
      </div>
      <div className="flex items-baseline justify-between text-xs text-text-muted mt-0.5">
        <span>{phaseLabel(guide, guide.currentPhase)}</span>
        <span className="tabular-nums">{done} / {total}</span>
      </div>
      <div className="h-1 rounded-full bg-bg-tertiary mt-1.5 overflow-hidden">
        <div className="h-full bg-text-primary" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      {next && (
        <div className="text-xs text-text-secondary mt-2 line-clamp-2 leading-snug">
          <span className="text-text-tertiary">Další: </span>{next.title}
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
