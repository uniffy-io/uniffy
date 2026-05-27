import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import type { CustomStatus } from '@/features/presence/store/presenceSlice';

/** Returns undefined when unset or expired. */
export function useCustomStatus(userId: string): CustomStatus | undefined {
    const customStatus = useAppSelector(
        (state) => state.presence.customStatuses[userId],
    );

    return useMemo(() => {
        if (!customStatus) return undefined;

        if (customStatus.expiresAt) {
            const expiresAt = new Date(customStatus.expiresAt);
            if (expiresAt <= new Date()) {
                return undefined;
            }
        }

        return customStatus;
    }, [customStatus]);
}
