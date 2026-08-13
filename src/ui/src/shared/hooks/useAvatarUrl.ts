/** Resolves a user's avatar URL against the org member directory, which is the authority on
 *  who has one. A user the directory does not cover gets `null` (initials) rather than a URL
 *  that is guaranteed to 404. Callers keep `onError` as a race guard for deleted avatars. */

import { useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchMembers } from '@/features/admin/store/adminThunks';
import { buildAvatarUrl } from '@/shared/utils/fileUrls';
import type { SerializedMemberInfo } from '@/features/admin/store/adminSlice';

// A page full of avatars mounts every effect in one commit, before any of them can
// observe the pending flag, so the single-flight latch has to live at module scope.
let directoryInFlight = false;

export function useAvatarUrl(userId: string, size: string = 'sm'): string | null {
    const dispatch = useAppDispatch();
    const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
    const membersFetched = useAppSelector((state) => state.admin.membersFetched);
    const membersLoading = useAppSelector((state) => state.admin.membersLoading);
    const currentUser = useAppSelector((state) => state.auth.user);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    useEffect(() => {
        // No org context (e.g. a pure platform operator): there is no member
        // directory to resolve against, so stay on the initials fallback.
        if (!userId || !organizationId || membersFetched || membersLoading || directoryInFlight) {
            return;
        }
        directoryInFlight = true;
        void dispatch(fetchMembers({ pageSize: 200 })).finally(() => {
            directoryInFlight = false;
        });
    }, [dispatch, userId, organizationId, membersFetched, membersLoading]);

    return useMemo(() => {
        if (!userId) return null;

        if (currentUser && currentUser.id === userId) {
            return currentUser.hasAvatar ? buildAvatarUrl(userId, size) : null;
        }

        const member = members.find((m) => m.userId === userId);
        if (!member) return null;

        return member.hasAvatar ? member.avatarUrl || buildAvatarUrl(userId, size) : null;
    }, [userId, size, members, currentUser]);
}
