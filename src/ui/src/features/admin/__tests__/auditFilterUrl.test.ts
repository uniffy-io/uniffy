/**
 * Round-trip and preset-math tests for the audit filter <-> URL helpers.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, type AuditFilter } from '@/features/admin/store/auditSlice';
import {
    filterToSearchParams,
    presetBounds,
    searchParamsToFilter,
} from '@/features/admin/pages/audit/filterUrl';

const SAMPLE: AuditFilter = {
    actorUserId: 'user-123',
    actions: ['auth.login_success', 'note.deleted'],
    resourceType: 'NOTE',
    resourceId: 'note-id',
    fromTime: '2026-05-01T00:00:00.000Z',
    toTime: '2026-05-20T23:59:59.000Z',
    sortDir: 'asc',
};

describe('filterToSearchParams', () => {
    it('round-trips a populated filter', () => {
        const params = filterToSearchParams(SAMPLE);
        const decoded = searchParamsToFilter(params);
        expect(decoded).toEqual(SAMPLE);
    });

    it('round-trips an empty filter to no params', () => {
        const params = filterToSearchParams(EMPTY_FILTER);
        expect([...params.keys()]).toEqual([]);
        expect(searchParamsToFilter(params)).toEqual(EMPTY_FILTER);
    });

    it('serialises action list as comma-delimited values', () => {
        const params = filterToSearchParams({
            ...EMPTY_FILTER,
            actions: ['a', 'b', 'c'],
        });
        expect(params.get('actions')).toBe('a,b,c');
    });

    it('round-trips sortDir asc through the URL', () => {
        const params = filterToSearchParams({ ...EMPTY_FILTER, sortDir: 'asc' });
        expect(params.get('sort')).toBe('asc');
        expect(searchParamsToFilter(params).sortDir).toBe('asc');
    });

    it('omits sort=desc from the URL (default value)', () => {
        const params = filterToSearchParams(EMPTY_FILTER);
        expect(params.get('sort')).toBeNull();
        expect(searchParamsToFilter(params).sortDir).toBe('desc');
    });
});

describe('presetBounds', () => {
    const NOW = new Date('2026-05-20T15:30:00.000Z');

    it('clears bounds for `all`', () => {
        expect(presetBounds('all', NOW)).toEqual({ fromTime: null, toTime: null });
    });

    it('clears bounds for `custom`', () => {
        expect(presetBounds('custom', NOW)).toEqual({ fromTime: null, toTime: null });
    });

    it('`today` anchors fromTime to start-of-day', () => {
        const { fromTime, toTime } = presetBounds('today', NOW);
        expect(toTime).toBe(NOW.toISOString());
        expect(fromTime).not.toBeNull();
        const from = new Date(fromTime!);
        expect(from.getHours()).toBe(0);
        expect(from.getMinutes()).toBe(0);
        expect(from.getDate()).toBe(NOW.getDate());
    });

    it('`7d` subtracts seven days from now', () => {
        const { fromTime } = presetBounds('7d', NOW);
        const expected = new Date(NOW);
        expected.setDate(expected.getDate() - 7);
        expect(fromTime).toBe(expected.toISOString());
    });

    it('`90d` subtracts ninety days from now', () => {
        const { fromTime } = presetBounds('90d', NOW);
        const expected = new Date(NOW);
        expected.setDate(expected.getDate() - 90);
        expect(fromTime).toBe(expected.toISOString());
    });
});
