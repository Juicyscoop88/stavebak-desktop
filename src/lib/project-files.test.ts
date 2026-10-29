import { describe, it, expect } from 'vitest';
import { projectFileKey } from './project-files';

describe('technické soubory projektu', () => {
  it('v kořeni projektu dostanou čitelný název', () => {
    expect(projectFileKey('/p/RD/stavebak.json', '/p/RD')).toBe('projectFiles.stavebakJson');
    expect(projectFileKey('/p/RD/CLAUDE.md', '/p/RD/')).toBe('projectFiles.claudeMd');
    expect(projectFileKey('C:\\p\\RD\\CLAUDE.md', 'C:\\p\\RD')).toBe('projectFiles.claudeMd');
  });

  it('jinde a ostatní soubory zůstanou pod svým názvem', () => {
    expect(projectFileKey('/p/RD/podklady/stavebak.json', '/p/RD')).toBeNull();
    expect(projectFileKey('/p/RD/zprava.md', '/p/RD')).toBeNull();
    expect(projectFileKey('/p/RD/claude.md', '/p/RD')).toBeNull();
    expect(projectFileKey('/p/RD/CLAUDE.md', '')).toBeNull();
  });
});
