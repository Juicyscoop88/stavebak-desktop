import { getPlatform } from './platform';

const NEW_ISSUE = 'https://github.com/Juicyscoop88/stavebak-desktop/issues/new';
// GitHub odmítne příliš dlouhou adresu, chyby bývají krátké a nejdůležitější je jejich začátek
const MAX_ERROR_CHARS = 1500;

export interface ProblemReport {
  /** Krátce, co uživatel dělal a co nešlo (česky). */
  summary: string;
  /** Popis od uživatele (volný text). */
  details?: string;
  /** Technický text chyby, jak ho vrátila aplikace. */
  error?: string;
  /** Cesty, které se z chyby vyřežou (název složky projektu bývá důvěrný). */
  redact?: string[];
}

/** Text chyby bez cest k projektu a domovské složky, ať se do veřejného issue nedostane nic z projektu. */
export function redactError(error: string, paths: string[] = []): string {
  let out = error;
  for (const p of paths.filter(Boolean)) {
    out = out.split(p).join('<projekt>');
    // Windows hlásí cesty i s prefixem \\?\ nebo s jinými lomítky
    out = out.split(p.replace(/\\/g, '/')).join('<projekt>');
  }
  out = out
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, '<domov>')
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '<domov>');
  return out.length > MAX_ERROR_CHARS ? `${out.slice(0, MAX_ERROR_CHARS)}… (zkráceno)` : out;
}

/** Adresa předvyplněného issue (šablona chyba.yml). Uživatel ho před odesláním vidí a může upravit. */
export function reportProblemUrl(report: ProblemReport, version: string): string {
  const platform = getPlatform();
  const system = platform === 'windows' ? 'Windows' : platform === 'mac' ? 'macOS' : 'Linux';
  const error = report.error ? redactError(report.error, report.redact) : '';
  const params = new URLSearchParams({
    template: 'chyba.yml',
    title: report.summary,
    co: `${report.details ? redactError(report.details, report.redact) : report.summary}${error ? `\n\nChyba z aplikace:\n\n\`\`\`\n${error}\n\`\`\`` : ''}`,
    verze: `${version}, ${system}`,
    labels: 'z-aplikace',
  });
  return `${NEW_ISSUE}?${params.toString()}`;
}

/** Otevře předvyplněné hlášení v prohlížeči. */
export async function reportProblem(report: ProblemReport): Promise<void> {
  const [{ getVersion }, { openUrl }] = await Promise.all([
    import('@tauri-apps/api/app'),
    import('@tauri-apps/plugin-opener'),
  ]);
  const version = await getVersion().catch(() => 'neznámá');
  await openUrl(reportProblemUrl(report, version));
}

const recent: string[] = [];
let capturing = false;

/** Drží posledních pár chyb z okna (neošetřené výjimky), ať je jde přiložit k hlášení. Jen v paměti. */
export function captureRecentErrors(): void {
  if (capturing || typeof window === 'undefined') return;
  capturing = true;
  const push = (text: string) => {
    recent.push(`${new Date().toISOString()} ${text}`.slice(0, 400));
    if (recent.length > 5) recent.shift();
  };
  window.addEventListener('error', (e) => push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => push(String(e.reason?.message ?? e.reason)));
}

export function recentErrors(): string[] {
  return [...recent];
}
