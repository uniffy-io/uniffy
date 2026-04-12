import { useEffect, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    fetchContentMembers,
    addContentMember,
    updateContentMemberRole,
    removeContentMember,
    setContentAccessMode,
    transferContentOwnership,
} from '@/features/permissions/store/permissionsThunks';

export function useContentMembers(contentType: number, contentId: string) {
    const dispatch = useAppDispatch();
    const key = `${contentType}:${contentId}`;
    const entry = useAppSelector((s) => s.permissions.byContent[key]);

    useEffect(() => {
        if (contentId && !entry) {
            dispatch(fetchContentMembers({ contentType, contentId }));
        }
    }, [contentType, contentId, dispatch, entry]);

    const add = useCallback(
        (subjectType: number, subjectId: string, role: number, expiresAt?: Date, note?: string) =>
            dispatch(addContentMember({ contentType, contentId, subjectType, subjectId, role, expiresAt, note })).unwrap(),
        [dispatch, contentType, contentId],
    );

    const update = useCallback(
        (subjectType: number, subjectId: string, newRole: number, note?: string) =>
            dispatch(updateContentMemberRole({ contentType, contentId, subjectType, subjectId, newRole, note })).unwrap(),
        [dispatch, contentType, contentId],
    );

    const remove = useCallback(
        (subjectType: number, subjectId: string, note?: string) =>
            dispatch(removeContentMember({ contentType, contentId, subjectType, subjectId, note })).unwrap(),
        [dispatch, contentType, contentId],
    );

    const setMode = useCallback(
        (accessMode: number, baselineRole: number | null, removeMembersOnNarrow?: boolean, note?: string) =>
            dispatch(
                setContentAccessMode({
                    contentType,
                    contentId,
                    accessMode,
                    baselineRole,
                    removeMembersOnNarrow,
                    note,
                }),
            ).unwrap(),
        [dispatch, contentType, contentId],
    );

    const transfer = useCallback(
        (newOwnerUserId: string, note?: string) =>
            dispatch(transferContentOwnership({ contentType, contentId, newOwnerUserId, note })).unwrap(),
        [dispatch, contentType, contentId],
    );

    const refresh = useCallback(
        () => dispatch(fetchContentMembers({ contentType, contentId })).unwrap(),
        [dispatch, contentType, contentId],
    );

    return {
        policy: entry?.policy ?? null,
        members: entry?.members ?? [],
        loading: entry?.loading.members ?? false,
        mutating: entry?.loading.mutation ?? false,
        error: entry?.errors.members ?? null,
        mutationError: entry?.errors.mutation ?? null,
        add,
        update,
        remove,
        setMode,
        transfer,
        refresh,
    };
}
