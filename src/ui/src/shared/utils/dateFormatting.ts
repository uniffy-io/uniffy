/**
 * Centralized date and time formatting utilities.
 *
 * All date display across the app should use these functions
 * instead of inline toLocaleDateString() calls.
 */

/**
 * Format a date string to short display: "Jan 22"
 * Adds year when the date is not in the current year: "Jan 22, 2025"
 */
export function formatDateShort(dateStr: string): string {
    const date = new Date(dateStr);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) {
        opts.year = 'numeric';
    }
    return date.toLocaleDateString('en-US', opts);
}

/**
 * Format a date string to full display: "Jan 22, 2026"
 */
export function formatDateFull(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/**
 * Format a date string with weekday: "Mon, Jan 22"
 */
export function formatDateWithWeekday(dateStr: string): string {
    const date = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Format a proto timestamp ({ seconds, nanos }) to short date.
 * Returns '-' if timestamp is falsy.
 */
export function formatProtoDate(timestamp?: { seconds: number | bigint; nanos: number }): string {
    if (!timestamp) return '-';
    const ms = typeof timestamp.seconds === 'bigint'
        ? Number(timestamp.seconds) * 1000
        : timestamp.seconds * 1000;
    const date = new Date(ms);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) {
        opts.year = 'numeric';
    }
    return date.toLocaleDateString(undefined, opts);
}

/**
 * Format a proto timestamp to date + time: "Jan 22, 2026, 2:30 PM"
 */
export function formatProtoDateTime(timestamp?: { seconds: number | bigint; nanos: number }): string {
    if (!timestamp) return '-';
    const ms = typeof timestamp.seconds === 'bigint'
        ? Number(timestamp.seconds) * 1000
        : timestamp.seconds * 1000;
    const date = new Date(ms);
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Check if a date string is in the past (before today).
 */
export function isOverdue(dateStr: string): boolean {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
}

/**
 * Format a date string as relative time: "just now", "5m ago", "3d ago".
 * Falls back to short date for dates older than 7 days.
 */
export function formatRelativeTime(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    if (diffDay < 30) return `${diffDay}d ago`;

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Format a date string as a smart date/time display:
 * - Today: "2:30 PM"
 * - Yesterday: "Yesterday, 4:15 PM"
 * - This week: "Mon, 10:00 AM"
 * - This year: "Apr 12, 2:30 PM"
 * - Older: "Apr 12, 2025, 2:30 PM"
 */
export function formatSmartDateTime(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);

    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    if (date >= todayStart) {
        return time;
    }
    if (date >= yesterdayStart) {
        return `Yesterday, ${time}`;
    }
    if (date >= weekStart) {
        const day = date.toLocaleDateString(undefined, { weekday: 'short' });
        return `${day}, ${time}`;
    }
    if (date.getFullYear() === now.getFullYear()) {
        const d = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `${d}, ${time}`;
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + `, ${time}`;
}

/**
 * Format seconds to media playback time: "1:23" or "1:02:03"
 */
export function formatMediaTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format bytes to human-readable file size: "1.5 MB"
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format a future date as remaining time: "for 3h 30m", "for 25m", "for 2d".
 * Returns empty string if the date is in the past or not provided.
 */
export function formatTimeRemaining(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const remaining = new Date(dateStr).getTime() - Date.now();
    if (remaining <= 0) return '';

    const mins = Math.floor(remaining / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (days > 0) {
        const leftoverHrs = hrs % 24;
        return leftoverHrs > 0 ? `for ${days}d ${leftoverHrs}h` : `for ${days}d`;
    }
    if (hrs > 0) {
        const leftoverMins = mins % 60;
        return leftoverMins > 0 ? `for ${hrs}h ${leftoverMins}m` : `for ${hrs}h`;
    }
    if (mins > 0) return `for ${mins}m`;
    return 'for <1m';
}
