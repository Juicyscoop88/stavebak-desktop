import { useEffect, useState } from 'react'
import { fetchProjectForm, type ProjectForm as Form } from './store'

/** Renders the server's new-project form generically: text fields and choices, no domain knowledge here. */
export function ProjectForm({ onSubmit, extra, onCancel }: {
  onSubmit: (values: Record<string, string>) => Promise<void>
  /** Below the fields; a function gets the current values (e.g. to preview the folder name) */
  extra?: React.ReactNode | ((values: Record<string, string>) => React.ReactNode)
  onCancel?: () => void
}) {
  const [form, setForm] = useState<Form | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProjectForm().then(setForm, (e) => setError(String(e)))
  }, [])

  if (!form) return <p className="text-sm text-text-muted">{error ?? 'Načítám…'}</p>

  const complete = form.fields.every((f) => !f.required || values[f.id]?.trim())
  const submit = async () => {
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(values)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="text-left">
      <h2 className="text-base font-medium text-text-primary mb-4">{form.title}</h2>
      <div className="space-y-5">
        {form.fields.map((f, i) => (
          <div key={f.id}>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{f.label}</label>
            {f.type === 'text' ? (
              <input
                autoFocus={i === 0}
                value={values[f.id] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border text-text-primary
                  placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
              />
            ) : (
              <div className="space-y-0.5">
                {(f.options ?? []).filter((o) => o.primary || showAll[f.id] || values[f.id] === o.id).map((o) => (
                  <label key={o.id} className="flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-md text-sm text-text-primary hover:bg-bg-secondary cursor-pointer">
                    <input
                      type="radio" name={f.id} checked={values[f.id] === o.id}
                      onChange={() => setValues({ ...values, [f.id]: o.id })}
                      className="accent-[var(--color-text-primary)]"
                    />
                    {o.label}
                  </label>
                ))}
                {!showAll[f.id] && (f.options ?? []).some((o) => !o.primary) && (
                  <button onClick={() => setShowAll({ ...showAll, [f.id]: true })}
                    className="text-xs text-text-muted hover:text-text-primary px-2 py-1 -mx-2 cursor-pointer">
                    Další typy…
                  </button>
                )}
              </div>
            )}
            {f.hint && <p className="text-xs text-text-tertiary mt-1.5">{f.hint}</p>}
          </div>
        ))}
      </div>
      {typeof extra === 'function' ? extra(values) : extra}
      {error && <p className="text-xs text-error mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-6">
        {onCancel && (
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-text-muted hover:bg-bg-secondary cursor-pointer">Zrušit</button>
        )}
        <button onClick={submit} disabled={!complete || busy}
          className="px-4 py-1.5 rounded-lg text-sm bg-text-primary text-text-inverse disabled:opacity-40 cursor-pointer">
          {busy ? 'Zakládám…' : form.submitLabel}
        </button>
      </div>
    </div>
  )
}
