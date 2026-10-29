import { describe, expect, it } from 'vitest';
import { redactError, reportProblemUrl } from './report-problem';

describe('redactError', () => {
  it('vyřízne cestu projektu i domovskou složku', () => {
    const out = redactError('Cannot move: C:\\Users\\Michal\\Documents\\Rekonstrukce RD\\x', ['C:\\Users\\Michal\\Documents\\Rekonstrukce RD']);
    expect(out).not.toContain('Rekonstrukce');
    expect(out).not.toContain('Michal');
  });
  it('zkrátí dlouhý text', () => {
    expect(redactError('x'.repeat(5000)).length).toBeLessThan(1600);
  });
});

describe('reportProblemUrl', () => {
  it('předvyplní šablonu, verzi a chybu', () => {
    const url = new URL(reportProblemUrl({ summary: 'Nejde smazat projekt', error: 'boom' }, '0.15.0'));
    expect(url.searchParams.get('template')).toBe('chyba.yml');
    expect(url.searchParams.get('co')).toContain('boom');
    expect(url.searchParams.get('verze')).toContain('0.15.0');
    expect(url.searchParams.get('labels')).toBe('z-aplikace');
  });
});
