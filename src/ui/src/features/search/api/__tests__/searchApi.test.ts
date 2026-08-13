import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchSpy = vi.fn().mockResolvedValue({ items: [], totalCount: 0 });

vi.mock('@connectrpc/connect', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@connectrpc/connect')>()),
    createClient: () => ({ search: searchSpy, resolveUrns: vi.fn() }),
}));

vi.mock('@/config/api', () => ({ unaryTransport: {} }));

const { searchApi } = await import('@/features/search/api/searchApi');

describe('searchApi.search', () => {
    beforeEach(() => searchSpy.mockClear());

    it('forwards the abort signal so a superseded search is cancelled', async () => {
        const controller = new AbortController();
        await searchApi.search({ organizationId: 'org', query: 'q' }, { signal: controller.signal });

        expect(searchSpy).toHaveBeenCalledTimes(1);
        expect(searchSpy.mock.calls[0][1]).toEqual({ signal: controller.signal });
    });

    it('works without options', async () => {
        await searchApi.search({ organizationId: 'org', query: 'q' });
        expect(searchSpy.mock.calls[0][1]).toEqual({ signal: undefined });
    });
});
