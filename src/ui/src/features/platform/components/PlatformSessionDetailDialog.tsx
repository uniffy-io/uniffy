import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Calendar,
    Clock,
    Info,
    Prohibit,
    Tag,
    X,
} from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { getAvatarGradientStyle, getInitials } from '@/components/subject/utils';
import { SubjectAvatarById } from '@/components/subject';
import { supportConsentApi } from '@/features/admin/api/supportConsentApi';
import {
    SupportSessionScope,
    SupportSessionState,
    type SupportSession,
} from '@uniffy/proto/support/v1/support_consent_pb';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

interface Props {
    session: SupportSession;
    onClose: () => void;
    onChanged: () => void;
}

function Field({
    label,
    icon: Icon,
    children,
    className,
}: {
    label: string;
    icon?: typeof Info;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={className}>
            <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 min-h-9">
                {Icon && <Icon size={16} weight="duotone" className="text-muted-foreground shrink-0" />}
                <span className="text-sm min-w-0 break-all">{children}</span>
            </div>
        </div>
    );
}

export function PlatformSessionDetailDialog({ session, onClose, onChanged }: Props) {
    const [submitting, setSubmitting] = useState(false);
    const [revokeOpen, setRevokeOpen] = useState(false);

    const submitRevoke = async (reason: string) => {
        setSubmitting(true);
        try {
            await supportConsentApi.revoke({ sessionId: session.id, reason });
            toast.success('Support session revoked');
            setRevokeOpen(false);
            onChanged();
            onClose();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    const canRevoke =
        session.state === SupportSessionState.PENDING ||
        session.state === SupportSessionState.ACTIVE;

    const operatorName = session.supportUserFullName || session.supportUserEmail;
    const scopeLabel =
        session.scope === SupportSessionScope.READ_WRITE ? 'Read-write' : 'Read-only';

    return (
        <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-2xl">
            <div className="flex items-center gap-3 p-4 border-b border-border">
                <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center text-sm font-semibold text-white shrink-0"
                    style={getAvatarGradientStyle(session.organizationName)}
                >
                    {getInitials(session.organizationName)}
                </div>
                <div className="flex-1 min-w-0">
                    <Link
                        to="/platform/organizations"
                        className="text-base font-semibold text-foreground truncate block hover:underline"
                    >
                        {session.organizationName || 'Organization'}
                    </Link>
                    <code className="text-xs text-muted-foreground font-mono truncate block">
                        {session.organizationSlug}
                    </code>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="text-muted-foreground hover:text-foreground p-1"
                    aria-label="Close"
                >
                    <X size={16} weight="bold" />
                </button>
            </div>

            <div className="p-4 max-h-[55vh] overflow-y-auto space-y-4">
                <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Operator</p>
                    <div className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                        {session.supportUserId ? (
                            <SubjectAvatarById
                                userId={session.supportUserId}
                                displayName={operatorName}
                                size="lg"
                            />
                        ) : (
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
                                style={getAvatarGradientStyle(operatorName)}
                            >
                                {getInitials(operatorName)}
                            </div>
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{operatorName}</p>
                            {session.supportUserFullName && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {session.supportUserEmail}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Reason" className="sm:col-span-2">
                        <span className="break-normal whitespace-pre-wrap">
                            {session.reason || '(no reason given)'}
                        </span>
                    </Field>
                    <Field label="Scope" icon={Tag}>
                        {scopeLabel}
                    </Field>
                    <Field label="State" icon={Info}>
                        <span className="capitalize">
                            {SupportSessionState[session.state]?.toLowerCase() || '-'}
                        </span>
                    </Field>
                    <Field label="Requested" icon={Calendar}>
                        {formatProtoDateTime(session.requestedAt)}
                    </Field>
                    {session.grantedAt && (
                        <Field label="Approved" icon={Calendar}>
                            {formatProtoDateTime(session.grantedAt)}
                            {session.grantedByEmail && (
                                <span className="text-muted-foreground"> by {session.grantedByEmail}</span>
                            )}
                        </Field>
                    )}
                    <Field label="Expires" icon={Clock}>
                        {formatProtoDateTime(session.expiresAt)}
                        {session.expiresAt && (
                            <span className="text-muted-foreground">
                                {' '}
                                ({formatRelativeTime(protoToDate(session.expiresAt)?.toISOString() ?? '')})
                            </span>
                        )}
                    </Field>
                    {session.revokedAt && (
                        <Field label="Revoked" icon={Prohibit}>
                            {formatProtoDateTime(session.revokedAt)}
                            {session.revokedByEmail && (
                                <span className="text-muted-foreground"> by {session.revokedByEmail}</span>
                            )}
                        </Field>
                    )}
                    <Field label="Session ID" className="sm:col-span-2">
                        <span className="font-mono text-xs">{session.id}</span>
                    </Field>
                </div>
            </div>

            {canRevoke && (
                <div className="flex items-center justify-end p-4 border-t border-border">
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={submitting}
                        onClick={() => setRevokeOpen(true)}
                    >
                        <Prohibit size={14} weight="duotone" /> Revoke session
                    </Button>
                </div>
            )}

            <ReasonDialog
                isOpen={revokeOpen}
                onClose={() => {
                    if (!submitting) setRevokeOpen(false);
                }}
                onConfirm={submitRevoke}
                title="Revoke support session?"
                description="Ends operator access immediately. The org owner sees the revoke in the audit log."
                reasonRequired={false}
                confirmLabel="Revoke"
                variant="danger"
                loading={submitting}
            />
        </Modal>
    );
}
