/** Bridges `online`/`offline` window events into the slice. `slow` and `falling-behind` come from the uploader's backpressure governor, not here. */

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
