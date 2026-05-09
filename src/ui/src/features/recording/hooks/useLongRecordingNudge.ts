/**
 * Long-recording nudge.
 *
 * Fires a non-blocking toast at 55 minutes ("You've been recording for
 * 55 minutes. Take a break or stop when ready.") and re-warns every
 * 30 minutes after that. Resets when the recording ends.
 *
 * Drives off `state.recording.startedAt` + `pausedDurationMs` + the
 * current `pausedAt`, so paused time does NOT count toward the elapsed
 * total - a clip that's been paused for an hour does not nag the user.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppSelector } from '@/app/hooks';

const FIRST_NUDGE_MS = 55 * 60 * 1000;
const REPEAT_INTERVAL_MS = 30 * 60 * 1000;
const POLL_MS = 60 * 1000;

const ACTIVE_STATES = new Set(['recording', 'paused']);

export function useLongRecordingNudge(): void {
    const recordingState = useAppSelector((state) => state.recording.state);
    const startedAt = useAppSelector((state) => state.recording.startedAt);
    const pausedDurationMs = useAppSelector((state) => state.recording.pausedDurationMs);
    const pausedAt = useAppSelector((state) => state.recording.pausedAt);
    const lastNudgeAtRef = useRef<number | null>(null);

    useEffect(() => {
        if (!ACTIVE_STATES.has(recordingState) || !startedAt) {
            lastNudgeAtRef.current = null;
            return;
        }

        const checkAndNudge = () => {
            if (!startedAt) return;
            const referenceNow = pausedAt ?? Date.now();
            const elapsedMs = referenceNow - startedAt - pausedDurationMs;
            if (elapsedMs < FIRST_NUDGE_MS) return;

            const last = lastNudgeAtRef.current;
            const dueForNudge =
                last === null
                || elapsedMs - last >= REPEAT_INTERVAL_MS;
            if (!dueForNudge) return;

            lastNudgeAtRef.current = elapsedMs;
            const minutes = Math.round(elapsedMs / 60_000);
            toast.warning(`Still recording (${minutes} min)`, {
                description: 'You can stop or keep going.',
                duration: 8_000,
            });
        };

        checkAndNudge();
        const id = window.setInterval(checkAndNudge, POLL_MS);
        return () => window.clearInterval(id);
    }, [recordingState, startedAt, pausedDurationMs, pausedAt]);
}
