/**
 * Sessions management section - shows active sessions with revocation controls.
 */

import { useEffect } from 'react';
import {
    Desktop,
    DeviceMobile,
    Globe,
    SignOut,
    SpinnerGap,
    Warning,
    X,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    fetchSessions,
    revokeSession,
    revokeOtherSessions,
    clearSessionsError,
} from '@/features/settings/store/sessionsSlice';

function formatRelativeTime(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
}

function getDeviceIcon(deviceLabel: string) {
    const lower = deviceLabel.toLowerCase();
    if (lower.includes('android') || lower.includes('ios') || lower.includes('iphone') || lower.includes('ipad')) {
        return DeviceMobile;
    }
    if (lower.includes('unknown')) {
        return Globe;
    }
    return Desktop;
}

export function SessionsSection() {
    const dispatch = useAppDispatch();
    const { sessions, loading, revoking, revokingAll, error } = useAppSelector(
        (state) => state.sessions,
    );

    useEffect(() => {
        dispatch(fetchSessions());
    }, [dispatch]);

    const otherSessionCount = sessions.filter((s) => !s.isCurrent).length;

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Active Sessions</h2>
                {otherSessionCount > 0 && (
                    <button
                        onClick={() => dispatch(revokeOtherSessions())}
                        disabled={revokingAll}
                        className="text-sm disabled:opacity-50 flex items-center gap-1"
                        style={{ color: 'var(--status-error)' }}
                    >
                        {revokingAll ? (
                            <SpinnerGap className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <SignOut className="w-3.5 h-3.5" />
                        )}
                        Sign out all other sessions
                    </button>
                )}
            </div>

            {error && (
                <div className="flex items-center justify-between rounded-lg px-4 py-2 text-sm status-error">
                    <div className="flex items-center gap-2">
                        <Warning className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                    <button
                        onClick={() => dispatch(clearSessionsError())}
                        className="p-0.5 hover:opacity-70 rounded"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {loading ? (
                <div className="bg-card rounded-lg border border-border p-8 flex items-center justify-center">
                    <SpinnerGap className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
            ) : sessions.length === 0 ? (
                <div className="bg-card rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">No active sessions found.</p>
                </div>
            ) : (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                    <div className="divide-y divide-border">
                        {sessions.map((session) => {
                            const DeviceIcon = getDeviceIcon(session.deviceLabel);
                            const isRevoking = revoking === session.id;

                            return (
                                <div
                                    key={session.id}
                                    className="flex items-center gap-3 px-4 py-3"
                                >
                                    <DeviceIcon className="w-5 h-5 text-muted-foreground flex-shrink-0" />

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-foreground truncate">
                                                {session.deviceLabel}
                                            </span>
                                            {session.isCurrent && (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium status-success">
                                                    This device
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Active {formatRelativeTime(session.lastActivity)}
                                        </div>
                                    </div>

                                    {!session.isCurrent && (
                                        <button
                                            onClick={() => dispatch(revokeSession(session.id))}
                                            disabled={isRevoking || revokingAll}
                                            className="p-1.5 rounded-md text-muted-foreground hover-destructive disabled:opacity-50 transition-colors"
                                            title="Revoke session"
                                        >
                                            {isRevoking ? (
                                                <SpinnerGap className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <SignOut className="w-4 h-4" />
                                            )}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>
    );
}
