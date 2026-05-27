/** rAF-driven elapsed-time hook; freezes display while paused by subtracting `pausedDurationMs` + in-flight pause window. */

import { useEffect, useState } from 'react';
import { useAppSelector } from '@/app/hooks';

const TICKING_STATES = new Set([
    'recording',
    'stopping',
    'flushing',
    'completing',
]);

const STATIC_DISPLAY_STATES = new Set(['paused']);

function formatElapsed(seconds: number): string {
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
}

export function useRecordingTimer(): string {
    const startedAt = useAppSelector((state) => state.recording.startedAt);
    const pausedDurationMs = useAppSelector((state) => state.recording.pausedDurationMs);
    const pausedAt = useAppSelector((state) => state.recording.pausedAt);
    const recordingState = useAppSelector((state) => state.recording.state);
    const isTicking = TICKING_STATES.has(recordingState);
    const showsStaticTime =
        isTicking || STATIC_DISPLAY_STATES.has(recordingState);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!isTicking || !startedAt) return;
        let raf = 0;
        const tick = () => {
            setNow(Date.now());
            raf = window.requestAnimationFrame(tick);
        };
        raf = window.requestAnimationFrame(tick);
        return () => {
            window.cancelAnimationFrame(raf);
        };
    }, [startedAt, isTicking]);

    if (!startedAt || !showsStaticTime) {
        return '00:00';
    }
    const wallClockMs = (pausedAt ?? now) - startedAt - pausedDurationMs;
    return formatElapsed(Math.max(0, wallClockMs / 1000));
}
