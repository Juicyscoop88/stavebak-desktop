import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/tauri-bridge', () => ({ bridge: { getHomeDir: async () => '/Users/projektant' } }));

import { defaultProjectsDir, displayPath, isTemporaryDir } from '../stores/newProjectStore';
import { useSettingsStore } from '../stores/settingsStore';

describe('výchozí složka nových projektů', () => {
  beforeEach(() => useSettingsStore.setState({ projectsDir: '', lastProject: '' }));

  it('bez volby jsou projekty v Dokumentech, ne vedle naposledy otevřené složky', async () => {
    useSettingsStore.setState({ lastProject: '/Users/projektant/Downloads/neco' });
    expect(await defaultProjectsDir()).toBe('/Users/projektant/Documents/Stavebák');
  });

  it('platí složka, kterou uživatel vybral', async () => {
    useSettingsStore.setState({ projectsDir: '/Volumes/NAS/Zakázky' });
    expect(await defaultProjectsDir()).toBe('/Volumes/NAS/Zakázky');
  });

  it('dočasná složka se nikdy nestane výchozí', async () => {
    useSettingsStore.setState({ projectsDir: '/tmp' });
    expect(await defaultProjectsDir()).toBe('/Users/projektant/Documents/Stavebák');
    expect(isTemporaryDir('/private/var/folders/x/y')).toBe(true);
    expect(isTemporaryDir('/Users/projektant/tmp')).toBe(false);
  });

  it('cesta se ukáže jako ve Finderu', () => {
    expect(displayPath('/Users/projektant/Documents/Stavebák/RD Tuchoměřice')).toBe('Dokumenty › Stavebák › RD Tuchoměřice');
    expect(displayPath('/Users/projektant/Zakázky')).toBe('~ › Zakázky');
  });
});
