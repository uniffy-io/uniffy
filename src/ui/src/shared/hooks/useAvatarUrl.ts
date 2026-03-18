/**
 * Hook to get a cache-busted avatar URL for a user.
 *
 * Looks up the user's avatarUrl from the admin members store (which includes
 * a ?v={hash} cache-busting parameter from the backend). Falls back to the
 * plain buildAvatarUrl() if the member data is not yet loaded.
 */

import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { buildAvatarUrl } from '@/shared/utils/fileUrls';
import type { SerializedMemberInfo } from '@/features/admin/store/adminSlice';

export function useAvatarUrl(userId: string, size: string = 'sm'): string {
    const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];

    return useMemo(() => {
        if (!userId) return '';
        const member = members.find((m) => m.userId === userId);
        return member?.avatarUrl || buildAvatarUrl(userId, size);
    }, [userId, size, members]);
}
