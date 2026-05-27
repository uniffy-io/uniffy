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
import { Button } from '@/components/ui/button';
import {
    fetchSessions,
    revokeSession,
    revokeOtherSessions,
    clearSessionsError,
} from '@/features/settings/store/sessionsSlice';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';

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
                    <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => dispatch(revokeOtherSessions())}
                        loading={revokingAll}
                    >
                        <SignOut className="w-3.5 h-3.5" />
                        Sign out all other sessions
                    </Button>
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
