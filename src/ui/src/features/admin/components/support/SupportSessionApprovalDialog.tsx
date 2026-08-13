import { useState } from 'react';
import { toast } from 'sonner';
import {
    Lifebuoy,
    Clock,
    UserCircle,
    Check,
    X,
    Prohibit,
} from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatProtoDateTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { supportConsentApi } from '@/features/admin/api/supportConsentApi';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import type { SupportSession } from '@uniffy/proto/support/v1/support_consent_pb';

interface Props {
    session: SupportSession;
    onClose: () => void;
    onChanged: () => void;
}

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

export function SupportSessionApprovalDialog({ session, onClose, onChanged }: Props) {
    const [submitting, setSubmitting] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);

    const requestedAt = protoToDate(session.requestedAt);
    const expiresAt = protoToDate(session.expiresAt);
    const durationMinutes =
        requestedAt && expiresAt
            ? Math.max(
                  1,
                  Math.round((expiresAt.getTime() - requestedAt.getTime()) / 60000),
              )
            : null;

    const handleApprove = async () => {
        setSubmitting(true);
        try {
            await supportConsentApi.approve({ sessionId: session.id });
            toast.success('Support session approved');
            onChanged();
            onClose();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleReject = () => setRejectOpen(true);

    const submitReject = async (reason: string) => {
        setSubmitting(true);
        try {
            await supportConsentApi.reject({ sessionId: session.id, reason });
            toast.success('Support session rejected');
            setRejectOpen(false);
            onChanged();
            onClose();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
        <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
            <div className="flex items-start gap-3 p-4 border-b border-border">
                <div className="p-2 rounded-lg bg-amber-500/15 shrink-0">
                    <Lifebuoy
                        size={20}
                        weight="duotone"
                        className="text-amber-700 dark:text-amber-300"
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-foreground">
                        Support access request
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        Platform operator is requesting temporary access
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close"
                >
                    <X size={16} weight="bold" />
                </button>
            </div>

            <div className="p-4 space-y-4">
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Operator
                    </label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <UserCircle
                            size={16}
                            weight="duotone"
                            className="text-muted-foreground"
                        />
                        <span className="text-sm break-all">
                            {session.supportUserFullName || session.supportUserEmail}
                        </span>
                        {session.supportUserFullName && (
                            <span className="text-xs text-muted-foreground ml-auto">
                                {session.supportUserEmail}
                            </span>
                        )}
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Reason
                    </label>
                    <p className="text-sm p-2 rounded-md bg-muted/50 whitespace-pre-wrap break-words">
                        {session.reason || '(no reason given)'}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                            Scope
                        </label>
                        <p className="text-sm p-2 rounded-md bg-muted/50">Read-only</p>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                            Duration
                        </label>
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
                            <Clock
                                size={14}
                                weight="duotone"
                                className="text-muted-foreground"
                            />
                            {durationMinutes ? `${durationMinutes} min` : '-'}
                        </div>
                    </div>
                </div>

                {expiresAt && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                            Hard deadline
                        </label>
                        <p className="text-sm p-2 rounded-md bg-muted/50">
                            {formatProtoDateTime(session.expiresAt)}
                        </p>
                    </div>
                )}

                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
                    The operator gets read-only access until the deadline. Every
                    action they take is recorded in your audit log under
                    <code className="mx-1 px-1 rounded bg-background/60">
                        actor_kind=support
                    </code>
                    . You can revoke at any time from the in-app banner.
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                <Button
                    variant="outline"
                    size="md"
                    onClick={handleReject}
                    disabled={submitting}
                >
                    <Prohibit size={14} weight="duotone" />
                    Reject
                </Button>
                <Button
                    variant="default"
                    size="md"
                    onClick={handleApprove}
                    disabled={submitting}
                >
                    <Check size={14} weight="bold" />
                    Approve
                </Button>
            </div>
        </Modal>
        <ReasonDialog
            isOpen={rejectOpen}
            onClose={() => {
                if (!submitting) setRejectOpen(false);
            }}
            onConfirm={submitReject}
            title="Reject support access?"
            description="The operator is notified. Tell them why so they can come back with a tighter scope."
            reasonRequired={false}
            confirmLabel="Reject"
            variant="danger"
            loading={submitting}
        />
        </>
    );
}
