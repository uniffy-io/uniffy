/**
 * Tag-slice subscription hooks that scope to a specific set of ids
 * and skip re-renders for unrelated tag mutations via ``shallowEqual``.
 */

import { shallowEqual } from 'react-redux';

import { useAppSelector } from '@/app/hooks';
import type { RootState } from '@/app/store';
import type { SerializedTag } from '@/features/tags/store/tagsThunks';

const EMPTY_TAGS: readonly SerializedTag[] = Object.freeze([]);

/**
 * Resolve a list of tag ids to their hydrated rows.
 *
 * Returns a stable empty array reference when ``ids`` is empty so a
 * component subscribed to it never re-renders for unrelated tag
 * activity. With non-empty ids the inner selector projects
 * ``state.tags.byId[id]`` per id, then ``shallowEqual`` short-circuits
 * the re-render when none of the listed tag refs changed.
 */
export function useTagsByIds(ids: readonly string[]): readonly SerializedTag[] {
    const empty = ids.length === 0;
    return useAppSelector(
        (state: RootState): readonly SerializedTag[] => {
            if (empty) return EMPTY_TAGS;
            const out: SerializedTag[] = [];
            for (const id of ids) {
                const tag = state.tags.byId[id];
                if (tag) out.push(tag);
            }
            return out;
        },
        shallowEqual,
    );
}

/**
 * Resolve a single tag id to its hydrated row, or ``undefined``.
 *
 * Subscribes only to that tag's slot in ``byId``; mutations to other
 * tags do not re-render the consumer.
 */
export function useTagById(id: string | null | undefined): SerializedTag | undefined {
    return useAppSelector((state: RootState) =>
        id ? state.tags.byId[id] : undefined,
    );
}
