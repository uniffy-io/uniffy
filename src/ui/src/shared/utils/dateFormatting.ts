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
