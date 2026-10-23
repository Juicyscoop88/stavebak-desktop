import { useEffect, useState } from 'react'
import { UploadSimple, ChatCircleText } from '@phosphor-icons/react'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  fetchParameterDictionary, saveParameters, importDocuments, runAction, actionTitle,
  type NextAction, type ParameterDef, type SaveResult,
} from './store'

/** Kinds whose missing values a person types in; the rest still go to Claude. */
export const FORM_KINDS = new Set(['ask-client', 'design'])

/** Types a plain field can hold; lists and geometry are Claude's job (documents, drawings). */
const FIELD_TYPES = new Set<ParameterDef['type']>(['text', 'number', 'boolean', 'enum', 'date'])

type Value = string | boolean

/**
 * The missing values of one guide action as a form. Fields, units and value labels come from
 * the server's dictionary; writing goes through set_parameters, exactly as when Claude writes.
 */
export function ActionForm({ action, onDone }: { action: NextAction; onDone: () => void }) {
  const [dict, setDict] = useState<Record<string, ParameterDef> | null>(null)
  const [values, setValues] = useState<Record<string, Value>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchParameterDictionary().then(setDict, (e) => setError(String(e))) }, [])

  if (!dict) return <p className="text-sm text-text-muted">{error ?? 'Načítám…'}</p>

  const ids = Object.keys(action.parameters ?? {})
  const fields = ids.filter((id) => dict[id] && FIELD_TYPES.has(dict[id].type))
  const elsewhere = ids.filter((id) => !fields.includes(id))
  const filled = Object.entries(values).filter(([, v]) => v !== '')
  const problem = (id: string) =>
    result?.errors.find((e) => e.id === id)?.message ?? (result?.conflicts.some((c) => c.id === id) ? 'Projekt už má hodnotu ze silnějšího zdroje, nepřepsáno.' : null)

  const save = async () => {
    if (!filled.length || busy) return
    setBusy(true)
    setError(null)
    try {
      const dir = useSettingsStore.getState().workingDirectory
      const parsed = Object.fromEntries(filled.map(([id, v]) => [id, parse(dict[id], v)]))
      const res = await saveParameters(dir, parsed)
      setResult(res)
      if (!res.errors.length && !res.conflicts.length) onDone()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {action.kind === 'ask-client' && (
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={async () => {
            const names = await importDocuments('Zadání nebo dokumenty od investora')
            if (names.length) runAction(`Nahrané podklady od investora: ${names.join(', ')}`)
          }}>
            <UploadSimple size={13} /> Nahrát zadání od investora
          </SecondaryButton>
          <SecondaryButton onClick={() => runAction(`Připrav dotazník pro investora: ${actionTitle(action)}`)}>
            <ChatCircleText size={13} /> Připravit dotazník pro investora
          </SecondaryButton>
        </div>
      )}

      <div className="space-y-3">
        {fields.map((id) => (
          <Field key={id} id={id} def={dict[id]} label={action.parameters?.[id] ?? dict[id].label}
            value={values[id] ?? ''} problem={problem(id)}
            onChange={(v) => setValues((prev) => ({ ...prev, [id]: v }))} />
        ))}
      </div>

      {elsewhere.length > 0 && (
        <p className="text-xs text-text-muted">
          Z dokumentů nebo výkresů doplní Claude: {elsewhere.map((id) => action.parameters?.[id] ?? id).join(', ')}.
        </p>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
      {result && result.applied.length > 0 && (result.errors.length > 0 || result.conflicts.length > 0) && (
        <p className="text-xs text-text-muted">Uloženo {result.applied.length}, zbytek je potřeba opravit.</p>
      )}

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-text-tertiary tabular-nums">{filled.length} z {fields.length}</span>
        <button onClick={save} disabled={!filled.length || busy}
          className="px-3 py-1.5 rounded-lg text-sm bg-text-primary text-text-inverse disabled:opacity-40 cursor-pointer disabled:cursor-default">
          {busy ? 'Ukládám…' : 'Uložit do projektu'}
        </button>
      </div>
    </div>
  )
}

function Field({ id, def, label, value, problem, onChange }: {
  id: string; def: ParameterDef; label: string; value: Value; problem: string | null; onChange: (v: Value) => void
}) {
  const input = 'w-full px-3 py-1.5 rounded-lg text-sm bg-bg-input border border-border text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none'
  let control: React.ReactNode
  if (def.type === 'boolean') {
    control = <Choice options={[['true', 'Ano'], ['false', 'Ne']]} value={value === '' ? '' : String(value)} onChange={(v) => onChange(v === 'true')} />
  } else if (def.type === 'enum') {
    const options = (def.values ?? []).map((v) => [v, def.valueLabels?.[v] ?? v] as [string, string])
    control = options.length <= 4
      ? <Choice options={options} value={String(value)} onChange={onChange} />
      : (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className={input}>
          <option value="">Vyberte…</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )
  } else {
    control = (
      <div className="flex items-center gap-2">
        <input id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}
          type={def.type === 'date' ? 'date' : 'text'} inputMode={def.type === 'number' ? 'decimal' : undefined}
          className={input} />
        {def.unit && <span className="text-sm text-text-muted flex-shrink-0">{def.unit}</span>}
      </div>
    )
  }
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      {control}
      {problem && <p className="text-xs text-error mt-1">{problem}</p>}
    </div>
  )
}

function Choice({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(value === v ? '' : v)}
          className={`px-3 py-1.5 rounded-lg text-sm border cursor-pointer ${value === v
            ? 'border-text-primary bg-text-primary text-text-inverse'
            : 'border-border text-text-primary hover:bg-bg-secondary'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-primary border border-border hover:bg-bg-secondary cursor-pointer">
      {children}
    </button>
  )
}

/** Numbers as people type them (decimal comma); the server validates the rest. */
function parse(def: ParameterDef, v: Value): unknown {
  if (def.type === 'number' && typeof v === 'string') {
    const n = Number(v.replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : v
  }
  return v
}
