import { useCallback, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    createSavedFilterThunk,
    deleteSavedFilterThunk,
    listSavedFiltersThunk,
    updateSavedFilterThunk,
    type SerializedSavedTagFilter,
} from '@/features/tags/store/tagsThunks';

type CreateThunkArg = Parameters<typeof createSavedFilterThunk>[0];
type UpdateThunkArg = Parameters<typeof updateSavedFilterThunk>[0];

export interface UseSavedTagFiltersReturn {
    filters: SerializedSavedTagFilter[];
    byId: Record<string, SerializedSavedTagFilter>;
    status: 'idle' | 'loading' | 'succeeded' | 'failed';
    error: string | null;
    refresh: () => void;
    create: (arg: CreateThunkArg) => Promise<SerializedSavedTagFilter>;
    update: (arg: UpdateThunkArg) => Promise<SerializedSavedTagFilter>;
    remove: (filterId: string) => Promise<unknown>;
}

export function useSavedTagFilters(): UseSavedTagFiltersReturn {
    const dispatch = useAppDispatch();
    const byId = useAppSelector((s) => s.tags.savedFilters.byId);
    const ids = useAppSelector((s) => s.tags.savedFilters.ids);
    const status = useAppSelector((s) => s.tags.savedFilters.status);
    const error = useAppSelector((s) => s.tags.savedFilters.error);

    useEffect(() => {
        if (status === 'idle') {
            dispatch(listSavedFiltersThunk());
        }
    }, [dispatch, status]);

    const filters = useMemo(
        () =>
            ids
                .map((id) => byId[id])
                .filter((f): f is SerializedSavedTagFilter => Boolean(f)),
        [ids, byId]
    );

    const refresh = useCallback(() => {
        dispatch(listSavedFiltersThunk());
    }, [dispatch]);

    const create = useCallback(
        (arg: CreateThunkArg) => dispatch(createSavedFilterThunk(arg)).unwrap(),
        [dispatch]
    );

    const update = useCallback(
        (arg: UpdateThunkArg) => dispatch(updateSavedFilterThunk(arg)).unwrap(),
        [dispatch]
    );

    const remove = useCallback(
        async (filterId: string) =>
            dispatch(deleteSavedFilterThunk({ filterId })).unwrap(),
        [dispatch]
    );

    return {
        filters,
        byId,
        status,
        error,
        refresh,
        create,
        update,
        remove,
    };
}
