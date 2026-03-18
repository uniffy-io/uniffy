import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import type { CustomStatus } from '@/features/presence/store/presenceSlice';

/**
 * Get the custom status for a single user.
 * Returns undefined if no custom status is set or if it has expired.
 */
export function useCustomStatus(userId: string): CustomStatus | undefined {
    const customStatus = useAppSelector(
        (state) => state.presence.customStatuses[userId],
    );

    return useMemo(() => {
        if (!customStatus) return undefined;

        // Check expiry
        if (customStatus.expiresAt) {
            const expiresAt = new Date(customStatus.expiresAt);
            if (expiresAt <= new Date()) {
                return undefined;
            }
        }

        return customStatus;
    }, [customStatus]);
}
