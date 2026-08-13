import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    Buildings,
    Calendar,
    CheckCircle,
    Clock,
    EnvelopeSimple,
    Info,
    ShieldCheck,
    SignOut,
    UserCircle,
    X,
    XCircle,
} from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { cn } from '@/shared/utils/cn';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { SubjectAvatarById } from '@/components/subject';
import { getAvatarGradientStyle, getInitials } from '@/components/subject/utils';
import { platformUsersApi } from '@/features/platform/api/systemDirectoryApi';
import type {
    PlatformUserDetail,
    PlatformUserMembership,
} from '@uniffy/proto/superadmin/v1/system_directory_pb';

type PendingUserAction = 'force-logout' | 'toggle-admin';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

type Tab = 'info' | 'memberships';

interface Props {
    userId: string;
    onClose: () => void;
    onChanged: () => void;
    selfId?: string;
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

export function PlatformUserDetailDialog({ userId, onClose, onChanged, selfId }: Props) {
    const [detail, setDetail] = useState<PlatformUserDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [tab, setTab] = useState<Tab>('info');
    const [pending, setPending] = useState<PendingUserAction | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const response = await platformUsersApi.get({ userId });
            setDetail(response.user ?? null);
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const runPending = async (reason: string) => {
        if (!detail?.summary || !pending) return;
        const kind = pending;
        const isAdmin = detail.summary.isSystemAdmin;
        setSubmitting(true);
        try {
            if (kind === 'force-logout') {
                await platformUsersApi.forceLogout({ userId, reason });
                toast.success('Logout forced');
            } else {
                await platformUsersApi.setSystemAdmin({
                    userId,
                    isSystemAdmin: !isAdmin,
                    reason,
                });
                toast.success(isAdmin ? 'System admin revoked' : 'System admin granted');
            }
            setPending(null);
            await refresh();
            onChanged();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
        { id: 'info', label: 'Info', icon: Info },
        { id: 'memberships', label: 'Memberships', icon: Buildings },
    ];

    const summary = detail?.summary;
    const isSelf = selfId === userId;
    const displayName = summary ? summary.fullName || summary.username || summary.email : 'User';
    const lastLogin = summary ? protoToDate(summary.lastLoginAt) : undefined;

    const renderInfoTab = () => {
        if (!summary) return null;
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Email" icon={EnvelopeSimple}>
                    <span className="inline-flex items-center gap-1.5">
                        {summary.email}
                        {summary.emailVerified ? (
                            <CheckCircle
                                size={14}
                                weight="fill"
                                className="text-emerald-600 dark:text-emerald-400 shrink-0"
                            />
                        ) : (
                            <XCircle size={14} className="text-muted-foreground shrink-0" />
                        )}
                    </span>
                </Field>
                <Field label="Username" icon={UserCircle}>
                    <span className="font-mono">@{summary.username}</span>
                </Field>
                {summary.fullName && <Field label="Full name">{summary.fullName}</Field>}
                <Field label="Role" icon={ShieldCheck}>
                    {summary.isSystemAdmin ? 'System administrator' : 'Member'}
                </Field>
                <Field label="Status" icon={summary.isActive ? CheckCircle : XCircle}>
                    {summary.isActive ? 'Active' : 'Inactive'}
                </Field>
                <Field label="Memberships" icon={Buildings}>
                    {summary.orgMembershipsCount} organization
                    {summary.orgMembershipsCount !== 1 ? 's' : ''}
                </Field>
                {lastLogin && (
                    <Field label="Last login" icon={Clock}>
                        {formatRelativeTime(lastLogin.toISOString())}
                    </Field>
                )}
                <Field label="Created" icon={Calendar}>
                    {formatProtoDateTime(summary.createdAt)}
                </Field>
            </div>
        );
    };

    const renderMembershipsTab = () => {
        if (!detail) return null;
        if (detail.memberships.length === 0) {
            return (
                <div className="text-center py-8">
                    <Buildings size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">Not a member of any organization</p>
                </div>
            );
        }
        return (
            <div className="space-y-2">
                {detail.memberships.map((m: PlatformUserMembership) => (
                    <div key={m.organizationId} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                        <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold text-white shrink-0"
                            style={getAvatarGradientStyle(m.organizationName)}
                        >
                            {getInitials(m.organizationName)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{m.organizationName}</p>
                            <code className="text-xs text-muted-foreground font-mono truncate block">
                                {m.organizationSlug}
                            </code>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {m.isSuspended && (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300">
                                    Suspended
                                </span>
                            )}
                            {m.deletedAt && (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-gradient-to-r from-red-100 to-red-200 text-red-700 dark:from-red-950 dark:to-red-900 dark:text-red-300">
                                    Deleted
                                </span>
                            )}
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                {m.role}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-2xl">
            <div className="flex items-center gap-3 p-4 border-b border-border">
                {summary ? (
                    <SubjectAvatarById userId={summary.id} displayName={displayName} size="lg" />
                ) : (
                    <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-foreground truncate">{displayName}</div>
                    {summary && (
                        <p className="text-xs text-muted-foreground truncate">{summary.email}</p>
                    )}
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

            <div className="flex border-b border-border">
                {tabs.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={cn(
                            'flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative',
                            tab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <Icon size={16} weight="duotone" />
                        {label}
                        {tab === id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                        )}
                    </button>
                ))}
            </div>

            <div className="p-4 max-h-[55vh] overflow-y-auto">
                {loading || !detail ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
                ) : tab === 'memberships' ? (
                    renderMembershipsTab()
                ) : (
                    renderInfoTab()
                )}
            </div>

            {summary && (
                <div className="flex flex-wrap items-center gap-2 p-4 border-t border-border">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={submitting || isSelf}
                        onClick={() => setPending('force-logout')}
                        title={isSelf ? 'Cannot force-logout yourself' : undefined}
                    >
                        <SignOut size={14} weight="duotone" /> Force logout
                    </Button>
                    <div className="ml-auto">
                        <Button
                            variant={summary.isSystemAdmin ? 'outline' : 'default'}
                            size="sm"
                            disabled={submitting || (isSelf && summary.isSystemAdmin)}
                            onClick={() => setPending('toggle-admin')}
                            title={
                                isSelf && summary.isSystemAdmin
                                    ? 'Cannot revoke your own system admin role'
                                    : undefined
                            }
                        >
                            <ShieldCheck size={14} weight="duotone" />
                            {summary.isSystemAdmin ? 'Revoke system admin' : 'Grant system admin'}
                        </Button>
                    </div>
                </div>
            )}

            <ReasonDialog
                isOpen={!!pending && !!summary}
                onClose={() => {
                    if (!submitting) setPending(null);
                }}
                onConfirm={runPending}
                title={
                    !summary
                        ? ''
                        : pending === 'force-logout'
                          ? `Force-logout ${summary.email}?`
                          : summary.isSystemAdmin
                            ? `Revoke system admin from ${summary.email}?`
                            : `Grant system admin to ${summary.email}?`
                }
                description={
                    pending === 'force-logout'
                        ? 'Bumps the token version and invalidates every active JWT for this user.'
                        : summary?.isSystemAdmin
                          ? 'User loses access to /platform/* and is logged out everywhere.'
                          : 'User gains access to /platform/* and is logged out everywhere.'
                }
                confirmLabel={
                    pending === 'force-logout'
                        ? 'Force logout'
                        : summary?.isSystemAdmin
                          ? 'Revoke'
                          : 'Grant'
                }
                variant={
                    pending === 'toggle-admin' && summary && !summary.isSystemAdmin
                        ? 'warning'
                        : 'danger'
                }
                loading={submitting}
            />
        </Modal>
    );
}
