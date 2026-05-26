import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Lifebuoy,
    UserCircle,
    Buildings,
    Calendar,
    Clock,
    Tag,
    Prohibit,
    Info,
    X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { supportSessionsApi } from '@/features/platform/api/supportSessionsApi';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import {
    SupportSessionState,
    type SupportSession,
} from '@uniffy/proto/superadmin/v1/support_session_pb';

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

export function PlatformSessionDetailPanel({ session, onClose, onChanged }: Props) {
    const { isMobileOrTablet } = useBreakpoint();
    const [submitting, setSubmitting] = useState(false);
    const [revokeOpen, setRevokeOpen] = useState(false);

    const handleRevoke = () => setRevokeOpen(true);

    const submitRevoke = async (reason: string) => {
        setSubmitting(true);
        try {
            await supportSessionsApi.revoke({ sessionId: session.id, reason });
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

    return (
        <div className="h-full flex flex-col bg-card">
            <div className="flex border-b border-border shrink-0">
                <div className="flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium text-foreground relative">
                    <Info size={16} weight="duotone" />
                    <span className="hidden xl:inline">Info</span>
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                </div>
                <button
                    onClick={onClose}
                    className="flex items-center justify-center px-2 py-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    aria-label="Close panel"
                >
                    <X size={16} weight="bold" />
                </button>
            </div>

            <div className="px-4 py-3 border-b border-border shrink-0 flex items-center gap-2 min-w-0">
                <Lifebuoy size={18} weight="duotone" className="text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate">
                        Support session
                    </div>
                    <code className="text-[10px] text-muted-foreground font-mono truncate block">
                        {session.id}
                    </code>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Organization
                    </label>
                    <Link
                        to={`/platform/organizations`}
                        className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-accent transition-colors"
                    >
                        <Buildings
                            size={16}
                            weight="duotone"
                            className="text-blue-600 dark:text-blue-400"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                                {session.organizationName}
                            </div>
                            <code className="text-xs text-muted-foreground font-mono">
                                {session.organizationSlug}
                            </code>
                        </div>
                    </Link>
                </div>

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
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                                {session.supportUserFullName || session.supportUserEmail}
                            </div>
                            {session.supportUserFullName && (
                                <div className="text-xs text-muted-foreground truncate">
                                    {session.supportUserEmail}
                                </div>
                            )}
                        </div>
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
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
                            <Tag
                                size={14}
                                weight="duotone"
                                className="text-muted-foreground"
                            />
                            Read-only
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                            State
                        </label>
                        <p className="text-sm p-2 rounded-md bg-muted/50 capitalize">
                            {SupportSessionState[session.state]?.toLowerCase() || '-'}
                        </p>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Requested
                    </label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Calendar
                            size={16}
                            weight="duotone"
                            className="text-muted-foreground"
                        />
                        <span className="text-sm">
                            {formatProtoDateTime(session.requestedAt)}
                        </span>
                    </div>
                </div>

                {session.grantedAt && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                            Approved
                        </label>
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                            <Calendar
                                size={16}
                                weight="duotone"
                                className="text-muted-foreground"
                            />
                            <span className="text-sm">
                                {formatProtoDateTime(session.grantedAt)}
                            </span>
                            {session.grantedByEmail && (
                                <span className="text-xs text-muted-foreground ml-auto truncate">
                                    by {session.grantedByEmail}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Expires
                    </label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Clock
                            size={16}
                            weight="duotone"
                            className="text-muted-foreground"
                        />
                        <span className="text-sm">
                            {formatProtoDateTime(session.expiresAt)}
                        </span>
                        {session.expiresAt && (
                            <span className="text-xs text-muted-foreground ml-auto">
                                {formatRelativeTime(
                                    protoToDate(session.expiresAt)?.toISOString() ?? '',
                                )}
                            </span>
                        )}
                    </div>
                </div>

                {session.revokedAt && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                            Revoked
                        </label>
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                            <Prohibit
                                size={16}
                                weight="duotone"
                                className="text-red-600 dark:text-red-400"
                            />
                            <span className="text-sm">
                                {formatProtoDateTime(session.revokedAt)}
                            </span>
                            {session.revokedByEmail && (
                                <span className="text-xs text-muted-foreground ml-auto truncate">
                                    by {session.revokedByEmail}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {canRevoke && (
                    <div className="pt-2">
                        <Button
                            variant="destructive"
                            size="md"
                            className="w-full"
                            disabled={submitting}
                            onClick={handleRevoke}
                        >
                            <Prohibit size={14} weight="duotone" /> Revoke session
                        </Button>
                    </div>
                )}
            </div>

            {isMobileOrTablet && (
                <div className="p-4 border-t border-border">
                    <Button
                        variant="outline"
                        size="md"
                        className="w-full"
                        onClick={onClose}
                    >
                        Close
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
        </div>
    );
}
