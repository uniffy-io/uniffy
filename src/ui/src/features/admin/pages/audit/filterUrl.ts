/**
 * URL <-> AuditFilter round-tripping for the audit-logs page.
 *
 * The page captures **filters only** in the URL - cursor, scroll, and
 * expanded-row state stay local. Sharing a link starts from the newest
 * event matching the filters.
 */

import type { AuditFilter } from '@/features/admin/store/auditSlice';
import { EMPTY_FILTER } from '@/features/admin/store/auditSlice';

export const DEFAULT_LOOKBACK_DAYS = 7;

export function defaultAuditFilter(now: Date = new Date()): AuditFilter {
    const start = new Date(now);
    start.setDate(start.getDate() - DEFAULT_LOOKBACK_DAYS);
    return { ...EMPTY_FILTER, fromTime: start.toISOString() };
}

const PARAM = {
    ACTOR: 'actor',
    ACTIONS: 'actions',
    RESOURCE_TYPE: 'resourceType',
    RESOURCE_ID: 'resourceId',
    FROM: 'from',
    TO: 'to',
    SORT: 'sort',
} as const;

export function filterToSearchParams(filter: AuditFilter): URLSearchParams {
    const params = new URLSearchParams();
    if (filter.actorUserId) params.set(PARAM.ACTOR, filter.actorUserId);
    if (filter.actions.length > 0) params.set(PARAM.ACTIONS, filter.actions.join(','));
    if (filter.resourceType) params.set(PARAM.RESOURCE_TYPE, filter.resourceType);
    if (filter.resourceId) params.set(PARAM.RESOURCE_ID, filter.resourceId);
    if (filter.fromTime) params.set(PARAM.FROM, filter.fromTime);
    if (filter.toTime) params.set(PARAM.TO, filter.toTime);
    if (filter.sortDir === 'asc') params.set(PARAM.SORT, 'asc');
    return params;
}

export function searchParamsToFilter(params: URLSearchParams): AuditFilter {
    const actions = params.get(PARAM.ACTIONS);
    return {
        ...EMPTY_FILTER,
        actorUserId: params.get(PARAM.ACTOR) || null,
        actions: actions ? actions.split(',').filter(Boolean) : [],
        resourceType: params.get(PARAM.RESOURCE_TYPE) || null,
        resourceId: params.get(PARAM.RESOURCE_ID) || null,
        fromTime: params.get(PARAM.FROM) || null,
        toTime: params.get(PARAM.TO) || null,
        sortDir: params.get(PARAM.SORT) === 'asc' ? 'asc' : 'desc',
    };
}

const PRESETS = {
    today: 0,
    '7d': 7,
    '30d': 30,
    '90d': 90,
} as const;

export type DateRangePreset = keyof typeof PRESETS | 'custom' | 'all';

/**
 * Resolve a preset key to (fromTime, toTime) ISO instants.
 *
 * Presets anchor to `now` for the upper bound and subtract the
 * preset's day count for the lower bound. `all` clears both bounds;
 * `custom` is the no-op placeholder the UI uses while the user is
 * editing the date inputs.
 */
export function presetBounds(
    preset: DateRangePreset,
    now: Date = new Date(),
): { fromTime: string | null; toTime: string | null } {
    if (preset === 'all' || preset === 'custom') {
        return { fromTime: null, toTime: null };
    }
    if (preset === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return { fromTime: start.toISOString(), toTime: now.toISOString() };
    }
    const days = PRESETS[preset];
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return { fromTime: start.toISOString(), toTime: now.toISOString() };
}
