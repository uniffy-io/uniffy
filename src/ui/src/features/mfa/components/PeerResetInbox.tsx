import { ShieldSlash } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/config';
import { mfaClient } from '@/features/mfa/api/mfaApi';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';

import type { PendingPeerReset } from '@uniffy/proto/auth/v1/mfa_pb';

type ProtoTimestamp = { seconds: bigint; nanos: number };

function protoSecondsToIso(ts: ProtoTimestamp | undefined): string {
    if (!ts) return '';
    return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000)).toISOString();
}

function minutesUntil(ts: ProtoTimestamp | undefined): string {
    if (!ts) return '';
    const expiresMs = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
    const diff = expiresMs - Date.now();
    if (diff <= 0) return 'expired';
    const minutes = Math.ceil(diff / 60_000);
    return `${minutes} min`;
}

interface PeerResetInboxProps {
    selfId: string | undefined;
    onApproved?: () => void;
}

/** Polls every 30s so the 10 minute peer-reset window stays visible without manual refresh. */
export function PeerResetInbox({ selfId, onApproved }: PeerResetInboxProps) {
    const [requests, setRequests] = useState<PendingPeerReset[]>([]);
    const [loading, setLoading] = useState(true);
    const [approvingId, setApprovingId] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const response = await mfaClient.listPlatformPeerResets({});
            setRequests(response.requests);
        } catch (err) {
            const raw = err instanceof Error ? err.message : String(err);
            const friendly = friendlyErrorMessage(raw);
            if (friendly) toast.error(friendly);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
        const id = window.setInterval(refresh, 30_000);
        return () => window.clearInterval(id);
    }, [refresh]);

    const handleApprove = async (request: PendingPeerReset) => {
        setApprovingId(request.requestId);
        try {
            await mfaClient.approvePlatformPeerReset({ requestId: request.requestId });
            toast.success(`Approved peer reset for ${request.targetEmail}`);
            await refresh();
            onApproved?.();
        } catch (err) {
            const raw = err instanceof Error ? err.message : 'Approve failed';
            toast.error(friendlyErrorMessage(raw) || raw);
        } finally {
            setApprovingId(null);
        }
    };

    if (loading) {
        return null;
    }
    if (requests.length === 0) {
        return null;
    }

    return (
        <section className="rounded-xl border border-rose-300/40 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
            <div className="mb-3 flex items-center gap-2">
                <ShieldSlash size={18} weight="duotone" className="text-rose-700 dark:text-rose-400" />
                <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                    Pending peer MFA resets
                </h3>
                <span className="rounded-full bg-rose-200/60 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                    {requests.length}
                </span>
            </div>

            <ul className="space-y-2">
                {requests.map((req) => {
                    const isOwn = req.requesterUserId === selfId;
                    return (
                        <li
                            key={req.requestId}
                            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground">
                                    Reset MFA on {req.targetEmail}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Requested by {req.requesterEmail}
                                    {' · '}
                                    {formatRelativeTime(protoSecondsToIso(req.createdAt))}
                                    {' · '}
                                    expires in {minutesUntil(req.expiresAt)}
                                </p>
                                {req.reason && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Reason: {req.reason}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {isOwn ? (
                                    <span className="text-xs text-muted-foreground italic">
                                        Awaiting another admin
                                    </span>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={approvingId === req.requestId}
                                        onClick={() => handleApprove(req)}
                                    >
                                        {approvingId === req.requestId ? 'Approving...' : 'Approve'}
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
