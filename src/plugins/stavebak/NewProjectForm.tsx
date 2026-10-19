import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNewProjectStore, defaultProjectsDir, folderNameFor } from '../../stores/newProjectStore'
import { openProject } from '../../lib/conversations'
import { LocationRow } from '../../components/layout/NewProjectDialog'
import { ProjectForm } from './ProjectForm'
import { createProjectFile } from './store'

/** "Nový projekt…": folder + stavebak.json from the server form, opened ready to work. */
export default function NewProjectForm() {
  const close = useNewProjectStore((s) => s.close)
  const [parent, setParent] = useState('')
  useEffect(() => { defaultProjectsDir().then(setParent) }, [])

  return (
    <ProjectForm
      onCancel={close}
      extra={<LocationRow parent={parent} onChange={setParent} />}
      onSubmit={async (values) => {
        const dir = `${parent}/${folderNameFor(values.name ?? 'Projekt')}`
        await invoke('create_project_directory', { path: dir })
        await createProjectFile(dir, values)
        close()
        await openProject(dir, { fresh: true })
      }}
    />
  )
}
