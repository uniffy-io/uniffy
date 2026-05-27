export {
    presenceReducer,
    updatePresence,
    updatePresenceWithCustomStatus,
    updateBulkPresence,
    setMyCustomStatus,
    clearMyCustomStatus,
    clearPresence,
    selectPresenceStatus,
    selectCustomStatus,
} from '@/features/presence/store/presenceSlice';
export type { CustomStatus } from '@/features/presence/store/presenceSlice';

export {
    fetchBulkPresence,
    setCustomStatus,
    clearCustomStatusThunk,
} from '@/features/presence/store/presenceThunks';

export { usePresence } from '@/features/presence/hooks/usePresence';
export { useCustomStatus } from '@/features/presence/hooks/useCustomStatus';
export { usePresenceHeartbeat } from '@/features/presence/hooks/usePresenceHeartbeat';
export { useBulkPresence } from '@/features/presence/hooks/useBulkPresence';

export { CustomStatusDisplay } from '@/features/presence/components/CustomStatusDisplay';
export { CustomStatusPicker } from '@/features/presence/components/CustomStatusPicker';
