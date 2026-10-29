import { describe, expect, it } from 'vitest';
import { tightenTaskLists } from './NotesEditor';

describe('tightenTaskLists', () => {
  it('zpevní seznam úkolů, ostatní text nechá', () => {
    const md = '## Otevřené otázky\n\n- [ ] Doložit souhlas\n\n- [x] Objednat radon\n\n- [ ] Třetí\n\nOdstavec\n\n- běžná odrážka\n\n- druhá';
    expect(tightenTaskLists(md)).toBe('## Otevřené otázky\n\n- [ ] Doložit souhlas\n- [x] Objednat radon\n- [ ] Třetí\n\nOdstavec\n\n- běžná odrážka\n\n- druhá');
  });
});
