import type { Locale } from '../stores/settingsStore';

export interface ChangelogCategory {
  label: Record<Locale, string>;
  items: Record<Locale, string[]>;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: Record<Locale, string[]>;
  categories?: ChangelogCategory[];
}

/**
 * Changelog entries for the "What's New" modal.
 * Only include versions with user-facing changes worth highlighting.
 * Ordered newest first. Update this when releasing a new version.
 */
export function getChangelog(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((entry) => entry.version === version);
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.14.0',
    date: '2026-10-25',
    highlights: {
      cs: ['Claude Code se přihlašuje jen vlastním přihlášením (účet Claude nebo vlastní API klíč), aplikace do přihlášení nezasahuje', 'Přihlašovací údaje Claude aplikace nikdy nečte'],
      en: ['Claude Code signs in only with your own sign-in (Claude account or your own API key); the app never interferes with it', 'The app never reads Claude credentials'],
      sk: ['Claude Code sa prihlasuje iba vlastným prihlásením (účet Claude alebo vlastný API kľúč), aplikácia do prihlásenia nezasahuje', 'Prihlasovacie údaje Claude aplikácia nikdy nečíta'],
      de: ['Claude Code meldet sich nur mit Ihrer eigenen Anmeldung an (Claude-Konto oder eigener API-Schlüssel), die App greift nicht ein', 'Die App liest nie Claude-Anmeldedaten'],
    },
  },
];
