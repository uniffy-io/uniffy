/**
 * Pure reducer tests for the audit slice.
 *
 * Network IO is mocked at the auditApi boundary so the slice's
 * loading / cursor / events transitions can be exercised without
 * hitting the connect transport or DOM.
 */

import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/admin/api/auditApi', () => ({
    auditApi: {
        listEvents: vi.fn(),
        exportEvents: vi.fn(),
    },
}));

import { auditApi } from '@/features/admin/api/auditApi';
import {
    EMPTY_FILTER,
    auditReducer,
    clearAuditState,
    fetchNewestEvents,
    fetchOlderEvents,
    jumpToDate,
    setFilter,
    type AuditFilter,
} from '@/features/admin/store/auditSlice';

function makeStore(initialAuthOrgId: string | null = 'org-1') {
    const authReducer = (
        state: { currentOrganizationId: string | null } = {
            currentOrganizationId: initialAuthOrgId,
        },
    ) => state;
    return configureStore({
        reducer: {
            audit: auditReducer,
            auth: authReducer,
        },
        middleware: (gdm) => gdm({ serializableCheck: false }),
    });
}

const buildResponse = (count: number, nextToken: string | null) => ({
    events: Array.from({ length: count }, (_, idx) => ({
        id: `event-${idx}`,
        organizationId: 'org-1',
        actorUserId: 'user-1',
        actorOrgRole: 'ADMIN',
        onBehalfOfUserId: undefined,
        action: 'note.deleted',
        resourceType: 'NOTE',
        resourceId: `note-${idx}`,
        detailsJson: '{}',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        createdAt: { seconds: BigInt(1700000000 + idx), nanos: 0 },
    })),
    nextPageToken: nextToken ?? undefined,
});

beforeEach(() => {
    vi.mocked(auditApi.listEvents).mockReset();
});

describe('audit reducer', () => {
    it('initialises with an empty filter and idle loading state', () => {
        const store = makeStore();
        const state = store.getState().audit;
        expect(state.filter).toEqual(EMPTY_FILTER);
        expect(state.loading).toBe('idle');
        expect(state.events).toEqual([]);
        expect(state.hasMore).toBe(false);
    });

    it('setFilter overrides the filter without touching the events list', () => {
        const store = makeStore();
        const next: AuditFilter = { ...EMPTY_FILTER, actions: ['note.deleted'] };
        store.dispatch(setFilter(next));
        expect(store.getState().audit.filter).toEqual(next);
        expect(store.getState().audit.events).toEqual([]);
    });

    it('clearAuditState resets every field', () => {
        const store = makeStore();
        store.dispatch(setFilter({ ...EMPTY_FILTER, actions: ['x'] }));
        store.dispatch(clearAuditState());
        expect(store.getState().audit.filter).toEqual(EMPTY_FILTER);
    });
});

describe('fetchNewestEvents', () => {
    it('replaces events and stores the cursor when the response includes one', async () => {
        const store = makeStore();
        vi.mocked(auditApi.listEvents).mockResolvedValueOnce(
            buildResponse(2, 'cursor-1') as never,
        );

        await store.dispatch(
            fetchNewestEvents({ organizationId: 'org-1', filter: EMPTY_FILTER }),
        );

        const state = store.getState().audit;
        expect(state.events).toHaveLength(2);
        expect(state.cursor).toBe('cursor-1');
        expect(state.hasMore).toBe(true);
        expect(state.loading).toBe('idle');
    });

    it('marks hasMore=false when the response has no next page token', async () => {
        const store = makeStore();
        vi.mocked(auditApi.listEvents).mockResolvedValueOnce(
            buildResponse(1, null) as never,
        );

        await store.dispatch(
            fetchNewestEvents({ organizationId: 'org-1', filter: EMPTY_FILTER }),
        );

        expect(store.getState().audit.hasMore).toBe(false);
        expect(store.getState().audit.cursor).toBeNull();
    });

    it('records an error message in state when the API rejects', async () => {
        const store = makeStore();
        vi.mocked(auditApi.listEvents).mockRejectedValueOnce(new Error('boom'));

        await store.dispatch(
            fetchNewestEvents({ organizationId: 'org-1', filter: EMPTY_FILTER }),
        );

        const state = store.getState().audit;
        expect(state.loading).toBe('error');
        expect(state.error).toMatch(/boom/);
    });
});

describe('fetchOlderEvents', () => {
    it('appends a second page to the existing list and updates the cursor', async () => {
        const store = makeStore();
        vi.mocked(auditApi.listEvents)
            .mockResolvedValueOnce(buildResponse(2, 'cursor-1') as never)
            .mockResolvedValueOnce(buildResponse(2, 'cursor-2') as never);

        await store.dispatch(
            fetchNewestEvents({ organizationId: 'org-1', filter: EMPTY_FILTER }),
        );
        await store.dispatch(fetchOlderEvents());

        const state = store.getState().audit;
        expect(state.events).toHaveLength(4);
        expect(state.cursor).toBe('cursor-2');
    });

    it('is a no-op when there is no cursor', async () => {
        const store = makeStore();
        const result = await store.dispatch(fetchOlderEvents());
        expect(result.meta.requestStatus).toBe('fulfilled');
        expect(auditApi.listEvents).not.toHaveBeenCalled();
    });
});

describe('jumpToDate', () => {
    it('overrides toTime in the filter and replaces the event list', async () => {
        const store = makeStore();
        vi.mocked(auditApi.listEvents).mockResolvedValueOnce(
            buildResponse(3, 'cursor-jumped') as never,
        );

        const target = '2026-05-15T23:59:59.000Z';
        await store.dispatch(
            jumpToDate({ organizationId: 'org-1', filter: EMPTY_FILTER, toTime: target }),
        );

        const state = store.getState().audit;
        expect(state.events).toHaveLength(3);
        expect(state.cursor).toBe('cursor-jumped');
        expect(state.filter.toTime).toBe(target);
    });
});
