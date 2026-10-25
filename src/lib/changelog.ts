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

export const CHANGELOG: ChangelogEntry[] = [];
