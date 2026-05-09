/**
 * Register a `beforeunload` listener while a recording or upload is in flight.
 * The browser shows its native confirm; we cannot change the message text.
 */

import { useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';

const ACTIVE_STATES = new Set([
    'requesting',
    'initiating-upload',
    'recording',
    'paused',
    'stopping',
    'flushing',
    'completing',
]);

export function useBeforeUnloadGuard(): void {
    const recordingState = useAppSelector((state) => state.recording.state);
    const isActive = ACTIVE_STATES.has(recordingState);

    useEffect(() => {
        if (!isActive) return;
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => {
            window.removeEventListener('beforeunload', handler);
        };
    }, [isActive]);
}
