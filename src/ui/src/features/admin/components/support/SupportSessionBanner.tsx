import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Lifebuoy, Clock, ShieldWarning } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/config';
import { supportConsentApi } from '@/features/admin/api/supportConsentApi';
import { SupportSessionApprovalDialog } from '@/features/admin/components/support/SupportSessionApprovalDialog';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import {
    SupportSessionState,
    type SupportSession,
} from '@uniffy/proto/support/v1/support_consent_pb';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const POLL_INTERVAL_MS = 30_000;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

function formatCountdown(target: Date): string {
    const secs = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const rem = m % 60;
        return `${h}h ${rem}m`;
    }
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function SupportSessionBanner() {
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const [sessions, setSessions] = useState<SupportSession[]>([]);
    const [pendingDialog, setPendingDialog] = useState<SupportSession | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [revokeTarget, setRevokeTarget] = useState<SupportSession | null>(null);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(async () => {
        if (!organizationId) {
            setSessions([]);
            return;
        }
        try {
            const response = await supportConsentApi.listOrg({
                organizationId,
                page: 0,
                pageSize: 25,
                includeInactive: false,
            });
            setSessions(response.sessions);
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        }
    }, [organizationId]);

    useEffect(() => {
        refresh();
        const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [refresh]);

    useEffect(() => {
        const id = window.setInterval(() => setTick((t) => t + 1), 1000);
        return () => window.clearInterval(id);
    }, []);

    const active = useMemo(
        () =>
            sessions.find(
                (s) => s.state === SupportSessionState.ACTIVE,
            ),
        [sessions],
    );
    const pending = useMemo(
        () =>
            sessions.find(
                (s) => s.state === SupportSessionState.PENDING,
            ),
        [sessions],
    );

    const handleRevoke = (session: SupportSession) => setRevokeTarget(session);

    const submitRevoke = async (reason: string) => {
        if (!revokeTarget) return;
        setRevoking(revokeTarget.id);
        try {
            await supportConsentApi.revoke({ sessionId: revokeTarget.id, reason });
            toast.success('Support session revoked');
            setRevokeTarget(null);
            refresh();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setRevoking(null);
        }
    };

    if (!organizationId) return null;
    if (!active && !pending) return null;

    const revokeDialog = (
        <ReasonDialog
            isOpen={!!revokeTarget}
            onClose={() => {
                if (!revoking) setRevokeTarget(null);
            }}
            onConfirm={submitRevoke}
            title="Revoke support session?"
            description="Ends operator access immediately. The revoke is recorded in the audit log."
            reasonRequired={false}
            confirmLabel="Revoke"
            variant="danger"
            loading={!!revoking}
        />
    );

    if (active) {
        const expires = protoToDate(active.expiresAt);
        const countdown = expires ? formatCountdown(expires) : '-';
        // Use `tick` so this re-renders every second for the countdown.
        void tick;
        return (
            <>
            <div
                role="banner"
                className="relative border-b border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            >
                <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
                <div className="px-3 md:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Lifebuoy size={16} weight="fill" className="shrink-0" />
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500 text-white shrink-0">
                            Support
                        </span>
                        <span className="text-xs md:text-sm truncate">
                            <strong>{active.supportUserEmail}</strong> is in your workspace
                            {active.reason && ` - ${active.reason}`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center gap-1 text-xs font-mono">
                            <Clock size={12} weight="duotone" />
                            {countdown}
                        </span>
                        <Button
                            variant="outline"
                            size="xs"
                            onClick={() => handleRevoke(active)}
                            disabled={revoking === active.id}
                        >
                            Revoke
                        </Button>
                    </div>
                </div>
            </div>
            {revokeDialog}
            </>
        );
    }

    return (
        <>
        <div
            role="banner"
            className="relative border-b border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
        >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
            <div className="px-3 md:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <ShieldWarning size={16} weight="fill" className="shrink-0" />
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500 text-white shrink-0">
                        Pending
                    </span>
                    <span className="text-xs md:text-sm truncate">
                        <strong>{pending!.supportUserEmail}</strong> is requesting support
                        access
                        {pending!.reason && ` - ${pending!.reason}`}
                    </span>
                </div>
                <Button
                    variant="default"
                    size="xs"
                    onClick={() => setPendingDialog(pending!)}
                >
                    Review
                </Button>
            </div>
            {pendingDialog && (
                <SupportSessionApprovalDialog
                    session={pendingDialog}
                    onClose={() => setPendingDialog(null)}
                    onChanged={refresh}
                />
            )}
        </div>
        {revokeDialog}
        </>
    );
}
