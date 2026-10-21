import { useState } from 'react'
import { CheckCircle, Circle, CircleDashed, Warning, ArrowRight, CaretUp } from '@phosphor-icons/react'
import { useStavebakStore, phaseLabel, runAction, nextStepAction, MIGRATE_ACTION, type GuideStep, type NextAction, actionTitle } from './store'
import { ActionForm, FORM_KINDS } from './ActionForm'

const czk = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`

function StepIcon({ status }: { status: GuideStep['status'] }) {
  if (status === 'done') return <CheckCircle size={15} weight="fill" className="text-success flex-shrink-0 mt-[3px]" />
  if (status === 'available') return <Circle size={15} weight="bold" className="text-text-primary flex-shrink-0 mt-[3px]" />
  return <CircleDashed size={15} weight="light" className="text-text-tertiary flex-shrink-0 mt-[3px]" />
}

/** Renderer for stavebak.json: project status from Stavebák `guide`. */
export default function ProjectOverview() {
  const { status, guide, error } = useStavebakStore()

  if (!guide) {
    return (
      <div className="p-6 text-sm text-text-muted">
        {status === 'error' ? `Stav projektu nejde načíst. ${error ?? ''}` : 'Načítám stav projektu…'}
      </div>
    )
  }

  const { done, total } = guide.progress
  const phases = guide.phases?.map((p) => p.id) ?? [...new Set(guide.steps.map((s) => s.phase))]
  const facts = [
    guide.category.label,
    guide.category.authorityDeadlineDays ? `lhůta úřadu ${guide.category.authorityDeadlineDays} dní` : null,
    guide.category.feeCzk ? `poplatek ${czk(guide.category.feeCzk)}` : null,
  ].filter(Boolean)

  return (
    <div className="overflow-auto h-full selectable">
      <div className="max-w-xl px-6 py-5 space-y-7">
        <header>
          <h1 className="text-lg font-semibold text-text-primary leading-snug">{guide.projectName ?? guide.buildingType.label}</h1>
          <p className="text-sm text-text-muted mt-0.5">{guide.buildingType.label} · {facts.join(' · ')}</p>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div className="h-full bg-text-primary" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-text-muted tabular-nums">{done} z {total} kroků</span>
          </div>
        </header>

        {guide.format?.hint && (
          <div className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-3">
            <div className="flex-1 text-sm text-text-secondary leading-snug">
              Projekt je uložený ve starším formátu. Stavebák z něj nepozná všechno, co už je hotové, takže skutečný stav může být dál.
            </div>
            <button
              onClick={() => runAction(MIGRATE_ACTION)}
              title="Pošle Claudovi pokyn v chatu"
              className="flex-shrink-0 px-2 py-1 rounded-md text-xs text-text-primary border border-border hover:bg-bg-secondary cursor-pointer"
            >
              Převést
            </button>
          </div>
        )}

        {guide.expiring.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Pozor na platnost</h2>
            <ul className="space-y-1.5">
              {guide.expiring.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm text-text-primary">
                  <Warning size={14} weight="bold" className="text-warning flex-shrink-0" />
                  <span className="flex-1">{e.label}</span>
                  <span className={`text-xs tabular-nums ${e.daysLeft < 0 ? 'text-error' : 'text-text-muted'}`}>
                    {e.daysLeft < 0 ? 'propadlo' : `${e.daysLeft} dní`} · do {new Date(e.validUntil).toLocaleDateString('cs-CZ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {guide.nextActions.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Co teď</h2>
            {/* One next step stands out; the rest are there, quieter */}
            <NextActionCard action={guide.nextActions[0]} primary />
            {guide.nextActions.length > 1 && (
              <ul className="mt-3 divide-y divide-border-subtle border-y border-border-subtle">
                {guide.nextActions.slice(1).map((a, i) => <li key={i}><NextActionCard action={a} /></li>)}
              </ul>
            )}
          </section>
        )}

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Postup</h2>
          <div className="space-y-5">
            {phases.map((phase) => (
              <div key={phase}>
                <h3 className={`text-sm font-semibold mb-1.5 ${phase === guide.currentPhase ? 'text-text-primary' : 'text-text-muted'}`}>
                  {phaseLabel(guide, phase)}
                </h3>
                <ul className="space-y-1.5">
                  {guide.steps.filter((s) => s.phase === phase).map((s) => {
                    const missing = Object.keys(s.missingFacts ?? {}).length
                    return (
                      <li key={s.id} className="flex gap-2.5">
                        <StepIcon status={s.status} />
                        <div className="min-w-0">
                          <div className={`text-sm leading-snug ${s.status === 'waiting' ? 'text-text-muted' : 'text-text-primary'}`}>
                            {s.label}
                          </div>
                          <div className="text-xs text-text-tertiary">
                            {s.duration}
                            {s.status !== 'done' && missing > 0 && ` · chybí ${missing} ${missing === 1 ? 'údaj' : missing < 5 ? 'údaje' : 'údajů'}`}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * One guide action. Values a person knows open a form right here (set_parameters, same as Claude);
 * anything else is handed to Claude in the chat.
 */
function NextActionCard({ action, primary = false }: { action: NextAction; primary?: boolean }) {
  const [open, setOpen] = useState(false)
  const hasForm = FORM_KINDS.has(action.kind) && Object.keys(action.parameters ?? {}).length > 0
  const missing = Object.keys(action.parameters ?? {}).length
  const button = hasForm
    ? (open ? <>Skrýt <CaretUp size={11} /></> : <>Vyplnit{missing ? ` (${missing})` : ''} <ArrowRight size={11} /></>)
    : <>Pokračovat <ArrowRight size={11} /></>
  const onClick = () => (hasForm ? setOpen(!open) : runAction(nextStepAction(actionTitle(action))))

  return (
    <div className={primary ? 'rounded-xl border border-border bg-bg-card p-4' : 'py-3'}>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-text-tertiary">{primary ? 'Další krok' : ''}{primary && action.kindLabel ? ' · ' : ''}{action.kindLabel ?? action.kind}</div>
          <div className={`${primary ? 'text-base' : 'text-sm'} font-medium text-text-primary mt-0.5`}>{actionTitle(action)}</div>
          {action.detail && <div className="text-sm text-text-muted mt-0.5">{action.detail}</div>}
          {action.leadTime && <div className="text-xs text-text-tertiary mt-1">Dodání: {action.leadTime}</div>}
        </div>
        <button onClick={onClick}
          title={hasForm ? 'Vyplnit chybějící údaje' : 'Pošle Claudovi pokyn v chatu'}
          className={`self-start flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm flex-shrink-0 cursor-pointer ${primary && !open
            ? 'bg-text-primary text-text-inverse'
            : 'text-text-primary border border-border hover:bg-bg-secondary'}`}>
          {button}
        </button>
      </div>
      {open && <div className="mt-4 pt-4 border-t border-border-subtle"><ActionForm action={action} onDone={() => setOpen(false)} /></div>}
    </div>
  )
}
