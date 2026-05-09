/**
 * Bridge `online` / `offline` browser events into the recording slice.
 *
 * Browsers fire `online` / `offline` on `window` whenever the OS-level
 * network changes. We mirror those into `state.recording.network`.
 *
 * The `slow` and `falling-behind` levels are NOT set here - they come
 * from the upload-backpressure governor in the streaming uploader.
 * This hook only handles the binary online/offline transitions; the
 * thunk owns the "uplink is too slow" narrative because it's the only
 * code path with access to actual queue depth.
 */

import { useEffect } from 'react';
import { useAppDispatch } from '@/app/hooks';
import { networkStatusChanged } from '@/features/recording/store/recordingSlice';

export function useNetworkStatus(): void {
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const sync = () => {
            dispatch(networkStatusChanged(navigator.onLine ? 'online' : 'offline'));
        };

        const onOnline = () => sync();
        const onOffline = () => {
            dispatch(networkStatusChanged('offline'));
        };

        sync();
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [dispatch]);
}
