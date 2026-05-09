/**
 * Queue-depth governor for the streaming uploader.
 *
 * The recording rate (`MediaRecorder` output) is decoupled from the upload
 * rate. On a slow uplink, the unsent backlog grows. Without bounds, the
 * recording would pin browser memory until OOM and the IndexedDB quota
 * would also blow.
 *
 * Levels:
 * - normal (< 50 MB): no UI, no events.
 * - slow (50-200 MB): banner warns the user; recording continues.
 * - falling-behind (200-500 MB): more urgent banner ("consider stopping").
 * - auto-stop (> 500 MB): the uploader requests a hard stop. The thunk
 *   then transitions the recorder into stop / flushing so we keep what
 *   we have rather than crashing the tab.
 *
 * Levels are sticky going up but only de-escalate after the backlog
 * drops below the level boundary minus a 10% hysteresis so the banner
 * does not flap around a threshold.
 */

export type BackpressureLevel = 'normal' | 'slow' | 'falling-behind' | 'auto-stop';

const SLOW_THRESHOLD = 50 * 1024 * 1024;
const FALLING_BEHIND_THRESHOLD = 200 * 1024 * 1024;
const AUTO_STOP_THRESHOLD = 500 * 1024 * 1024;

const HYSTERESIS = 0.9;

function thresholdFor(level: BackpressureLevel): number {
    switch (level) {
        case 'auto-stop':
            return AUTO_STOP_THRESHOLD;
        case 'falling-behind':
            return FALLING_BEHIND_THRESHOLD;
        case 'slow':
            return SLOW_THRESHOLD;
        case 'normal':
        default:
            return 0;
    }
}

export function classifyBacklog(
    backlogBytes: number,
    current: BackpressureLevel,
): BackpressureLevel {
    if (backlogBytes >= AUTO_STOP_THRESHOLD) return 'auto-stop';

    let next: BackpressureLevel;
    if (backlogBytes >= FALLING_BEHIND_THRESHOLD) {
        next = 'falling-behind';
    } else if (backlogBytes >= SLOW_THRESHOLD) {
        next = 'slow';
    } else {
        next = 'normal';
    }

    // De-escalation hysteresis: only step DOWN once the backlog dips
    // below 90% of the previous level's floor; this prevents the banner
    // from flapping around an exact threshold when the upload rate
    // briefly equals the capture rate.
    if (next === 'normal' && current !== 'normal') {
        if (backlogBytes >= HYSTERESIS * thresholdFor(current)) {
            return current;
        }
    } else if (next === 'slow' && current === 'falling-behind') {
        if (backlogBytes >= HYSTERESIS * FALLING_BEHIND_THRESHOLD) {
            return 'falling-behind';
        }
    }

    return next;
}

export const BACKPRESSURE_THRESHOLDS = {
    slow: SLOW_THRESHOLD,
    fallingBehind: FALLING_BEHIND_THRESHOLD,
    autoStop: AUTO_STOP_THRESHOLD,
} as const;
