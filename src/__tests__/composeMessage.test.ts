import { describe, it, expect } from 'vitest';
import { hasSendableContent, withAttachedFiles } from '../lib/composeMessage';

describe('zpráva s přílohami', () => {
  it('samotná příloha bez textu se smí odeslat', () => {
    expect(hasSendableContent('', false, 1)).toBe(true);
    expect(hasSendableContent('  ', false, 0)).toBe(false);
    expect(hasSendableContent('', true, 0)).toBe(true);
    expect(hasSendableContent('ahoj', false, 0)).toBe(true);
  });

  it('bez textu pošle jen nadpis a cesty', () => {
    expect(withAttachedFiles('', ['/tmp/a.png'], '[Připojené soubory]')).toBe('[Připojené soubory]\n/tmp/a.png');
    expect(withAttachedFiles('Co to je?', ['/tmp/a.png', '/tmp/b.pdf'], '[Připojené soubory]'))
      .toBe('Co to je?\n\n[Připojené soubory]\n/tmp/a.png\n/tmp/b.pdf');
    expect(withAttachedFiles('text', [], 'x')).toBe('text');
  });
});
