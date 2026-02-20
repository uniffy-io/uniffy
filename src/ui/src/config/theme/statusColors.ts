/**
 * Status Colors
 *
 * Centralized color definitions for status indicators across the app.
 * Used for toast notifications, badges, alerts, and other status-driven UI.
 *
 * These are fixed semantic colors (not theme-dependent) following the
 * convention from the frontend docs:
 *   - Success: green
 *   - Error: red
 *   - Warning: yellow
 *   - Info: uses the user's accent/primary color
 */

export type StatusType = 'success' | 'error' | 'warning' | 'info';

/** Hex color values for each status type. */
export const STATUS_HEX_COLORS: Record<StatusType, string> = {
    error: '#dc2626',
    success: '#22c55e',
    warning: '#eab308',
    info: 'hsl(var(--primary))',
};

/** CSS custom property names, set on :root for use in stylesheets. */
export const STATUS_CSS_VARS: Record<StatusType, string> = {
    error: '--status-error',
    success: '--status-success',
    warning: '--status-warning',
    info: '--status-info',
};
