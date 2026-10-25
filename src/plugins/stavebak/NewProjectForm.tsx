import { useEffect, useState } from 'react'
import { useNewProjectStore, defaultProjectsDir, createProjectDirectory } from '../../stores/newProjectStore'
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
      extra={(values) => <LocationRow parent={parent} name={values.name} onChange={setParent} />}
      onSubmit={async (values) => {
        const dir = await createProjectDirectory(parent, values.name || 'Projekt')
        await createProjectFile(dir, values)
        close()
        await openProject(dir, { fresh: true })
      }}
    />
  )
}
