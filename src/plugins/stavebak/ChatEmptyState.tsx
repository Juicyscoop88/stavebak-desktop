import { useEffect } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { useUiStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStavebakStore, phaseLabel, runAction, nextStepAction, createProjectFile } from './store'
import { ProjectForm } from './ProjectForm'

/** Empty chat of an open folder: set up the project (form), or pick up at the next step the server suggests. */
export default function ChatEmptyState() {
  const { status, guide } = useStavebakStore()

  // The setup form is the only thing to do here, so no chat input next to it
  useEffect(() => {
    useUiStore.getState().setComposerHidden(status === 'missing')
    return () => useUiStore.getState().setComposerHidden(false)
  }, [status])

  if (status === 'missing') {
    // Existing folder without a project: the same form, written straight into it
    return (
      <div className="flex items-center justify-center h-full px-6">
        <div className="w-full max-w-sm">
          <ProjectForm onSubmit={async (values) => {
            const dir = useSettingsStore.getState().workingDirectory
            await createProjectFile(dir, values)
            await useStavebakStore.getState().load(dir)
          }} />
        </div>
      </div>
    )
  }

  if (status !== 'ready' || !guide) return null

  const next = guide.nextActions[0]
  return (
    <Center>
      <p className="text-base text-text-primary mb-1">{guide.projectName ?? guide.buildingType.label}</p>
      <p className="text-sm text-text-muted mb-5">
        {phaseLabel(guide, guide.currentPhase)} · {guide.progress.done} z {guide.progress.total} kroků
      </p>
      {next && (
        <>
          <p className="text-sm text-text-secondary mb-3">Další krok: {next.title}</p>
          <PrimaryButton onClick={() => runAction(nextStepAction(next.title))}>Pokračovat</PrimaryButton>
        </>
      )}
    </Center>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center h-full text-center px-6">{children}</div>
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-text-primary text-text-inverse cursor-pointer hover:opacity-90"
    >
      {children} <ArrowRight size={13} />
    </button>
  )
}
