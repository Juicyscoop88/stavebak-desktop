import { ArrowRight } from '@phosphor-icons/react'
import { useStavebakStore, phaseLabel, sendChat, nextStepMessage, SETUP_MESSAGE } from './store'

/** Empty chat of an open folder: start the project, or pick up at the next step the server suggests. */
export default function ChatEmptyState() {
  const { status, guide } = useStavebakStore()

  if (status === 'missing') {
    return (
      <Center>
        <p className="text-base text-text-primary mb-1">Tahle složka zatím není projekt Stavebáku.</p>
        <p className="text-sm text-text-muted mb-5">Claude se zeptá na pár údajů o stavbě a připraví postup.</p>
        <PrimaryButton onClick={() => sendChat(SETUP_MESSAGE)}>Založit projekt</PrimaryButton>
      </Center>
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
          <PrimaryButton onClick={() => sendChat(nextStepMessage(next.title))}>Pokračovat</PrimaryButton>
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
