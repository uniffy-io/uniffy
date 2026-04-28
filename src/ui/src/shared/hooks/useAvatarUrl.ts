/**
 * Hook to get a cache-busted avatar URL for a user.
 *
 * Returns `null` when we know the user has no avatar (member loaded with
 * `hasAvatar === false`). Returns a constructed URL when the member has an
 * avatar OR when the member is not yet loaded — callers must still tolerate
 * a 404 in the latter case via image `onError`.
 */

import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { buildAvatarUrl } from '@/shared/utils/fileUrls';
import type { SerializedMemberInfo } from '@/features/admin/store/adminSlice';

export function useAvatarUrl(userId: string, size: string = 'sm'): string | null {
    const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
    const currentUser = useAppSelector((state) => state.auth.user);

    return useMemo(() => {
        if (!userId) return null;

        if (currentUser && currentUser.id === userId) {
            return currentUser.hasAvatar ? buildAvatarUrl(userId, size) : null;
        }

        const member = members.find((m) => m.userId === userId);
        if (member) {
            return member.hasAvatar ? (member.avatarUrl || buildAvatarUrl(userId, size)) : null;
        }

        return buildAvatarUrl(userId, size);
    }, [userId, size, members, currentUser]);
}
