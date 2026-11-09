/** Pure helpers over the server's `guide` answer: no domain logic, older servers still work. */
import type { GuideResult, GuideStep } from './store'

const PROJECT_FILE = 'stavebak.json'

/** Comparable form of a path: forward slashes, no Windows long-path prefix, drive letter case ignored. */
function comparable(path: string): string {
  const unified = path.replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/+$/, '')
  return /^[a-zA-Z]:/.test(unified) ? unified.toLowerCase() : unified
}

/** Is this file-watcher path the project's stavebak.json? Windows reports paths with backslashes. */
export function isProjectFile(path: string, dir: string): boolean {
  return comparable(path) === comparable(`${dir.replace(/[\\/]+$/, '')}/${PROJECT_FILE}`)
}

/** How far a step is, 0 to 1. */
export function stepFraction(step: Pick<GuideStep, 'status' | 'completion'>): number {
  if (step.status === 'done') return 1
  const c = step.completion
  return c && c.total > 0 ? c.known / c.total : 0
}

/** Whole-project progress in percent: the server's value, or closed steps from an older server. */
export function overallPercent(guide: Pick<GuideResult, 'progress'>): number {
  const { done, total, percent } = guide.progress
  return percent ?? (total ? Math.round((done / total) * 100) : 0)
}

/** "2 z 15 kroků · 3 rozpracované · 24 %" */
export function progressText(guide: Pick<GuideResult, 'progress'>): string {
  const { done, total, started, percent } = guide.progress
  const parts = [`${done} z ${total} kroků`]
  if (started) parts.push(started === 1 ? '1 rozpracovaný' : started < 5 ? `${started} rozpracované` : `${started} rozpracovaných`)
  if (percent !== undefined) parts.push(`${percent} %`)
  return parts.join(' · ')
}
