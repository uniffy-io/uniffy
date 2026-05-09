/**
 * useTagFilterState
 *
 * Owns the explorer rail's local filter state and keeps it in sync
 * with the URL so a filtered view is shareable / reload-safe. The
 * ``criteria`` shape mirrors ``SerializedTagFilterCriteria`` from
 * tagsThunks.
 *
 * URL params:
 *   - tags        comma-separated tag ids
 *   - types       comma-separated content type values (the proto
 *                 ContentType numbers; explorer renders to friendly
 *                 labels via the urnTypes config)
 *   - owners      comma-separated user ids
 *   - sources     comma-separated of {manual, inline}
 *   - createdAfter / createdBefore / updatedAfter / updatedBefore
 *                 ISO timestamps
 *   - access      access mode value (proto enum number)
 *   - untagged    "1" when ``untagged_only`` is on
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    ContentType,
    AccessMode as ProtoAccessMode,
} from '@uniffy/proto/common/v1/common_pb';
import {
    emptyCriteria,
    type SerializedTagFilterCriteria,
} from '@/features/tags/store/tagsThunks';

const splitCsv = (value: string | null): string[] =>
    value ? value.split(',').filter(Boolean) : [];

const DOMAIN_TO_CONTENT_TYPE: Record<string, ContentType> = {
    note: ContentType.NOTE,
    file: ContentType.FILE,
    event: ContentType.CALENDAR_EVENT,
    calendar: ContentType.CALENDAR_EVENT,
    calendar_event: ContentType.CALENDAR_EVENT,
    chat: ContentType.CHAT,
    channel: ContentType.CHAT,
    agent: ContentType.AGENT,
    project: ContentType.PROJECT,
    task: ContentType.TASK,
};

function readFromParams(params: URLSearchParams): SerializedTagFilterCriteria {
    const sources = splitCsv(params.get('sources')).filter(
        (s): s is 'manual' | 'inline' => s === 'manual' || s === 'inline'
    );
    let types = splitCsv(params.get('types'))
        .map((v) => Number.parseInt(v, 10))
        .filter((n): n is ContentType => Number.isFinite(n));
    if (types.length === 0) {
        const domainTypes = splitCsv(params.get('domain'))
            .map((d) => DOMAIN_TO_CONTENT_TYPE[d.toLowerCase()])
            .filter((t): t is ContentType => t !== undefined);
        if (domainTypes.length > 0) types = domainTypes;
    }
    const accessRaw = params.get('access');
    const access = accessRaw !== null ? Number.parseInt(accessRaw, 10) : NaN;
    return {
        tagIds: splitCsv(params.get('tags')),
        contentTypes: types,
        ownerIds: splitCsv(params.get('owners')),
        sources,
        createdAfter: params.get('createdAfter'),
        createdBefore: params.get('createdBefore'),
        updatedAfter: params.get('updatedAfter'),
        updatedBefore: params.get('updatedBefore'),
        accessMode: Number.isFinite(access) ? (access as ProtoAccessMode) : null,
        untaggedOnly: params.get('untagged') === '1',
    };
}

function writeToParams(
    base: URLSearchParams,
    criteria: SerializedTagFilterCriteria
): URLSearchParams {
    const next = new URLSearchParams(base);
    const setOrDelete = (key: string, value: string | null) => {
        if (value && value.length > 0) next.set(key, value);
        else next.delete(key);
    };
    setOrDelete('tags', criteria.tagIds.join(','));
    setOrDelete('types', criteria.contentTypes.map(String).join(','));
    next.delete('domain');
    setOrDelete('owners', criteria.ownerIds.join(','));
    setOrDelete('sources', criteria.sources.join(','));
    setOrDelete('createdAfter', criteria.createdAfter);
    setOrDelete('createdBefore', criteria.createdBefore);
    setOrDelete('updatedAfter', criteria.updatedAfter);
    setOrDelete('updatedBefore', criteria.updatedBefore);
    setOrDelete(
        'access',
        criteria.accessMode !== null ? String(criteria.accessMode) : null
    );
    setOrDelete('untagged', criteria.untaggedOnly ? '1' : null);
    return next;
}

export function isCriteriaEmpty(criteria: SerializedTagFilterCriteria): boolean {
    return (
        criteria.tagIds.length === 0 &&
        criteria.contentTypes.length === 0 &&
        criteria.ownerIds.length === 0 &&
        criteria.sources.length === 0 &&
        !criteria.createdAfter &&
        !criteria.createdBefore &&
        !criteria.updatedAfter &&
        !criteria.updatedBefore &&
        criteria.accessMode === null &&
        !criteria.untaggedOnly
    );
}

export function criteriaEquals(
    a: SerializedTagFilterCriteria,
    b: SerializedTagFilterCriteria
): boolean {
    const arrEq = (x: readonly (string | number)[], y: readonly (string | number)[]) =>
        x.length === y.length && x.every((v, i) => v === y[i]);
    return (
        arrEq([...a.tagIds].sort(), [...b.tagIds].sort()) &&
        arrEq([...a.contentTypes].sort(), [...b.contentTypes].sort()) &&
        arrEq([...a.ownerIds].sort(), [...b.ownerIds].sort()) &&
        arrEq([...a.sources].sort(), [...b.sources].sort()) &&
        a.createdAfter === b.createdAfter &&
        a.createdBefore === b.createdBefore &&
        a.updatedAfter === b.updatedAfter &&
        a.updatedBefore === b.updatedBefore &&
        a.accessMode === b.accessMode &&
        a.untaggedOnly === b.untaggedOnly
    );
}

export interface UseTagFilterStateReturn {
    criteria: SerializedTagFilterCriteria;
    setCriteria: (next: SerializedTagFilterCriteria) => void;
    patch: (patch: Partial<SerializedTagFilterCriteria>) => void;
    reset: () => void;
    isEmpty: boolean;
}

export function useTagFilterState(): UseTagFilterStateReturn {
    const [searchParams, setSearchParams] = useSearchParams();
    const criteria = useMemo(() => readFromParams(searchParams), [searchParams]);

    const setCriteria = useCallback(
        (next: SerializedTagFilterCriteria) => {
            setSearchParams(
                (current) => writeToParams(current, next),
                { replace: false }
            );
        },
        [setSearchParams]
    );

    const patch = useCallback(
        (partial: Partial<SerializedTagFilterCriteria>) => {
            setCriteria({ ...criteria, ...partial });
        },
        [criteria, setCriteria]
    );

    const reset = useCallback(() => setCriteria(emptyCriteria()), [setCriteria]);

    return {
        criteria,
        setCriteria,
        patch,
        reset,
        isEmpty: isCriteriaEmpty(criteria),
    };
}
