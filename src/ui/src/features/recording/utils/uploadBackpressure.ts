/**
 * Queue-depth governor. Levels: normal (<50MB), slow (50-200MB), falling-behind (200-500MB),
 * auto-stop (>500MB, hard-stop to avoid OOM). 10% hysteresis on de-escalation so the banner doesn't flap.
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

    // De-escalation hysteresis: only step DOWN below 90% of previous level's floor.
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
