import { describe, it, expect, vi } from 'vitest';
vi.mock('./tauri-bridge', () => ({ bridge: {} }));
import { stavebakToolTitle, isHiddenTool, useToolTitles } from './tool-titles';

describe('názvy nástrojů', () => {
  it('nástroj Stavebáku dostane český název ze serveru, jinak obecný popisek', () => {
    expect(stavebakToolTitle('mcp__stavebak__classify_project')).toBe('Stavebák');
    useToolTitles.setState({ titles: { classify_project: 'Zařazení stavby' } });
    expect(stavebakToolTitle('mcp__stavebak__classify_project')).toBe('Zařazení stavby');
  });

  it('ostatní nástroje nechá být, ToolSearch skryje', () => {
    expect(stavebakToolTitle('Read')).toBeNull();
    expect(isHiddenTool('ToolSearch')).toBe(true);
    expect(isHiddenTool('Read')).toBe(false);
  });
});

describe('ovládání aplikací', () => {
  it('nástroje lokálního serveru mají český název bez načtení ze serveru', () => {
    expect(stavebakToolTitle('mcp__stavebak-computer__computer_click')).toBe('Kliknutí v aplikaci');
    expect(stavebakToolTitle('mcp__stavebak-computer__neznamy')).toBe('Ovládání aplikace');
  });
});
