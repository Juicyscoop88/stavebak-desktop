import { useEffect } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { useUiStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStavebakStore, runAction, prefillChat, createProjectFile, importDocuments, DOCUMENTS_DIR } from './store'
import { ProjectForm } from './ProjectForm'


const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Empty chat of an open folder: set up the project (form), or show what you can do here. */
export default function ChatEmptyState() {
  const { status, guide } = useStavebakStore()

  // The setup form is the only thing to do here, so no chat input next to it
  useEffect(() => {
    useUiStore.getState().setComposerHidden(status === 'missing')
    return () => useUiStore.getState().setComposerHidden(false)
  }, [status])

  // Documents dropped on (or picked into) the zone: hand them to Claude right away
  useEffect(() => {
    const onImported = (e: Event) => {
      const names = (e as CustomEvent<string[]>).detail.map(fileName)
      runAction(`Nahrané podklady: ${names.join(', ')}`)
    }
    window.addEventListener('stavebak:files-imported', onImported)
    return () => window.removeEventListener('stavebak:files-imported', onImported)
  }, [])

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

  const docs = guide.expectedDocuments ?? []
  return (
    <div className="flex items-center justify-center h-full px-6">
      <div className="w-full max-w-xl">
        <h2 className="text-lg font-medium text-text-primary">{guide.projectName ?? guide.buildingType.label}</h2>
        <p className="text-sm text-text-muted mt-0.5">{guide.buildingType.label} · {guide.category.label.toLowerCase()}</p>

        <div
          data-drop-import={DOCUMENTS_DIR}
          className="mt-6 flex items-center gap-4 rounded-xl border border-dashed border-border px-5 py-5"
        >
          <DownloadSimple size={22} weight="light" className="text-text-tertiary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary">Přetáhněte sem podklady</p>
            <p className="text-xs text-text-muted mt-0.5 leading-snug">
              {docs.length > 0 && <>{docs.slice(0, 4).join(', ')}{docs.length > 4 ? ' a další' : ''}. </>}
              Stavebák z nich vytáhne údaje.
            </p>
          </div>
          <button onClick={pickDocuments}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs text-text-secondary border border-border hover:bg-bg-secondary cursor-pointer">
            Vybrat soubory
          </button>
        </div>

        {(guide.suggestions?.length ?? 0) > 0 && (
          <div className="mt-6">
            <p className="text-xs text-text-tertiary mb-1.5">Nebo se zeptejte</p>
            <div className="-mx-3">
              {guide.suggestions!.map((s) => (
                <button key={s} onClick={() => prefillChat(s)}
                  className="block w-full text-left px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary cursor-pointer">
                  › {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Vybrat soubory": copy into podklady/ and hand the files to Claude right away. */
async function pickDocuments() {
  const names = await importDocuments()
  if (names.length) runAction(`Nahrané podklady: ${names.join(', ')}`)
}
