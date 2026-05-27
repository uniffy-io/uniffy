import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    Buildings,
    ShieldCheck,
    SignOut,
    CheckCircle,
    XCircle,
    Info,
    Calendar,
    Clock,
    EnvelopeSimple,
    UserCircle,
    X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { platformUsersApi } from '@/features/platform/api/systemDirectoryApi';
import { ReasonDialog } from '@/components/ui/reason-dialog';
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

export function PlatformUserDetailPanel({ userId, onClose, onChanged, selfId }: Props) {
    const { isMobileOrTablet } = useBreakpoint();
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

    const guardedRun = async (run: () => Promise<void>) => {
        setSubmitting(true);
        try {
            await run();
            await refresh();
            onChanged();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleForceLogout = () => setPending('force-logout');
    const handleToggleSystemAdmin = () => setPending('toggle-admin');

    const runPending = (reason: string) => {
        if (!detail?.summary || !pending) return;
        const isAdmin = detail.summary.isSystemAdmin;
        const kind = pending;
        setPending(null);
        guardedRun(async () => {
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
        });
    };

    const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
        { id: 'info', label: 'Info', icon: Info },
        { id: 'memberships', label: 'Memberships', icon: Buildings },
    ];

    const summary = detail?.summary;
    const isSelf = selfId === userId;
    const lastLogin = summary ? protoToDate(summary.lastLoginAt) : undefined;

    const renderInfoTab = () => {
        if (!summary) return null;
        return (
            <div className="space-y-4">
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <EnvelopeSimple size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm break-all">{summary.email}</span>
                        {summary.emailVerified ? (
                            <CheckCircle size={14} weight="fill" className="text-emerald-600 dark:text-emerald-400 shrink-0 ml-auto" />
                        ) : (
                            <XCircle size={14} className="text-muted-foreground shrink-0 ml-auto" />
                        )}
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Username</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <UserCircle size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm font-mono">@{summary.username}</span>
                    </div>
                </div>

                {summary.fullName && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Full name</label>
                        <p className="text-sm p-2 rounded-md bg-muted/50">{summary.fullName}</p>
                    </div>
                )}

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Role</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <ShieldCheck size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">
                            {summary.isSystemAdmin ? 'System administrator' : 'Member'}
                        </span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        {summary.isActive ? (
                            <CheckCircle size={16} weight="duotone" className="text-emerald-600 dark:text-emerald-400" />
                        ) : (
                            <XCircle size={16} weight="duotone" className="text-amber-600 dark:text-amber-400" />
                        )}
                        <span className="text-sm">{summary.isActive ? 'Active' : 'Inactive'}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Memberships</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Buildings size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">
                            {summary.orgMembershipsCount} organization{summary.orgMembershipsCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>

                {lastLogin && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Last login</label>
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                            <Clock size={16} weight="duotone" className="text-muted-foreground" />
                            <span className="text-sm">{formatRelativeTime(lastLogin.toISOString())}</span>
                        </div>
                    </div>
                )}

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Created</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Calendar size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">{formatProtoDateTime(summary.createdAt)}</span>
                    </div>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                    <Button
                        variant="outline"
                        size="md"
                        className="w-full"
                        disabled={submitting || isSelf}
                        onClick={handleForceLogout}
                        title={isSelf ? 'Cannot force-logout yourself' : undefined}
                    >
                        <SignOut size={14} weight="duotone" /> Force logout
                    </Button>
                    <Button
                        variant={summary.isSystemAdmin ? 'outline' : 'default'}
                        size="md"
                        className="w-full"
                        disabled={submitting || (isSelf && summary.isSystemAdmin)}
                        onClick={handleToggleSystemAdmin}
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
            <div className="space-y-4">
                <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Organizations ({detail.memberships.length})
                    </h4>
                    <div className="space-y-2">
                        {detail.memberships.map((m: PlatformUserMembership) => (
                            <div key={m.organizationId} className="p-2 rounded-md bg-muted/50">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Buildings size={14} weight="duotone" className="text-muted-foreground shrink-0" />
                                    <span className="text-sm font-medium truncate flex-1">{m.organizationName}</span>
                                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground shrink-0">
                                        {m.role}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 pl-6 mt-0.5">
                                    <code className="text-xs text-muted-foreground font-mono truncate">{m.organizationSlug}</code>
                                </div>
                                {(m.isSuspended || m.deletedAt) && (
                                    <div className="flex items-center gap-2 pl-6 mt-1">
                                        {m.isSuspended && (
                                            <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400">
                                                Suspended
                                            </span>
                                        )}
                                        {m.deletedAt && (
                                            <span className="text-[10px] uppercase tracking-wider font-semibold text-red-700 dark:text-red-400">
                                                Deleted
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        if (loading || !detail) {
            return (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-4">
                    Loading...
                </div>
            );
        }
        switch (tab) {
            case 'memberships':
                return renderMembershipsTab();
            default:
                return renderInfoTab();
        }
    };

    return (
        <div className="h-full flex flex-col bg-card">
            <div className="flex border-b border-border shrink-0">
                {isMobileOrTablet && (
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center px-2 py-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        aria-label="Close panel"
                    >
                        <X size={16} weight="bold" />
                    </button>
                )}
                {tabs.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors relative',
                            tab === id
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <Icon size={16} weight="duotone" />
                        <span className="hidden xl:inline">{label}</span>
                        {tab === id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                        )}
                    </button>
                ))}
                {!isMobileOrTablet && (
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center px-2 py-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        aria-label="Close panel"
                    >
                        <X size={16} weight="bold" />
                    </button>
                )}
            </div>

            {summary && (
                <div className="px-4 py-3 border-b border-border shrink-0 flex items-center gap-3 min-w-0">
                    <div
                        className={cn(
                            'h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                            summary.isSystemAdmin
                                ? 'bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400'
                                : 'bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 text-blue-600 dark:text-blue-400',
                        )}
                    >
                        {(summary.username || summary.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">
                            {summary.fullName || summary.username || summary.email}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{summary.email}</div>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">{renderContent()}</div>

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
        </div>
    );
}
