/** Returns null when `hasAvatar === false`, a constructed URL when the member is loaded with an avatar or not yet loaded. Callers must tolerate 404 via `onError` in the latter case. */

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
