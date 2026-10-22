import { describe, it, expect, vi, beforeEach } from 'vitest';

const files: Record<string, string> = {};
const writes: string[] = [];

vi.mock('../../lib/tauri-bridge', () => ({
  bridge: {
    getHomeDir: vi.fn(async () => '/home/u'),
    readFileContent: vi.fn(async (p: string) => {
      if (!(p in files)) throw new Error('missing');
      return files[p];
    }),
    writeFileContent: vi.fn(async (p: string, c: string) => {
      writes.push(p);
      files[p] = c;
    }),
    getStavebakMcp: vi.fn(async () => ({ url: 'http://localhost:3535/mcp', env: 'local' })),
  },
}));

import { useMcpStore } from '../mcpStore';

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  writes.length = 0;
  useMcpStore.setState({ servers: [], target: null });
});

describe('mcpStore: built-in Stavebák server comes from the app', () => {
  it('takes the target from the app, first in the list, ignoring a stale entry in ~/.claude.json', async () => {
    files['/home/u/.claude.json'] = JSON.stringify({
      mcpServers: { stavebak: { type: 'http', url: 'https://stavebak.cz/mcp' }, other: { type: 'http', url: 'https://x' } },
    });
    await useMcpStore.getState().fetchServers();
    const { servers, target } = useMcpStore.getState();
    expect(target).toEqual({ url: 'http://localhost:3535/mcp', env: 'local' });
    expect(servers.map((s) => [s.name, s.config.url])).toEqual([
      ['stavebak', 'http://localhost:3535/mcp'],
      ['other', 'https://x'],
    ]);
  });

  it('never writes ~/.claude.json to set up the default server', async () => {
    await useMcpStore.getState().ensureDefaultServer();
    expect(writes).toEqual([]);
    expect(useMcpStore.getState().servers[0]?.name).toBe('stavebak');
  });

  it('keeps the built-in server after the user adds their own', async () => {
    await useMcpStore.getState().fetchServers();
    await useMcpStore.getState().addServer('mine', { command: '', args: [], env: {}, type: 'http', url: 'https://m' });
    expect(useMcpStore.getState().servers.map((s) => s.name)).toEqual(['stavebak', 'mine']);
  });
});
