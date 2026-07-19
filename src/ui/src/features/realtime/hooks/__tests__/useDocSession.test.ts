import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { composeWhenSynced } from '@/features/realtime/hooks/useDocSession';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('composeWhenSynced', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays pending after server sync until hydrate completes', async () => {
    let resolveServer!: () => void;
    let resolveHydrate!: () => void;
    const server = new Promise<void>((resolve) => (resolveServer = resolve));
    const hydrate = new Promise<void>((resolve) => (resolveHydrate = resolve));

    let settled = false;
    void composeWhenSynced(server, hydrate).then(() => (settled = true));

    resolveServer();
    await flush();
    expect(settled).toBe(false);

    resolveHydrate();
    await flush();
    expect(settled).toBe(true);
  });

  it('stays pending after hydrate until the server syncs', async () => {
    let resolveServer!: () => void;
    const server = new Promise<void>((resolve) => (resolveServer = resolve));

    let settled = false;
    void composeWhenSynced(server, Promise.resolve()).then(() => (settled = true));

    await flush();
    expect(settled).toBe(false);

    resolveServer();
    await flush();
    expect(settled).toBe(true);
  });

  it('resolves and warns when hydrate rejects', async () => {
    const hydrate = Promise.reject(new Error('idb unavailable'));

    let settled = false;
    void composeWhenSynced(Promise.resolve(), hydrate).then(() => (settled = true));

    await flush();
    expect(settled).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[realtime] persistence hydrate failed',
      expect.any(Error),
    );
  });
});
