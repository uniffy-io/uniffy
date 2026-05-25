import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    Buildings,
    Crown,
    ShieldWarning,
    Trash,
    ArrowCounterClockwise,
    Prohibit,
    Info,
    Calendar,
    Key,
    Envelope,
    Users as UsersIcon,
    Tag,
    Clock,
    UserCircle,
    Lifebuoy,
    X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { platformOrgsApi } from '@/features/platform/api/systemDirectoryApi';
import { RequestSupportSessionDialog } from '@/features/platform/components/RequestSupportSessionDialog';
import type { PlatformOrganizationDetail } from '@uniffy/proto/superadmin/v1/system_directory_pb';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

type Tab = 'info' | 'owners';

interface Props {
    organizationId: string;
    onClose: () => void;
    onChanged: () => void;
}

export function PlatformOrgDetailPanel({ organizationId, onClose, onChanged }: Props) {
    const { isMobileOrTablet } = useBreakpoint();
    const [detail, setDetail] = useState<PlatformOrganizationDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [tab, setTab] = useState<Tab>('info');
    const [supportOpen, setSupportOpen] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const response = await platformOrgsApi.get({ organizationId });
            setDetail(response.organization ?? null);
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

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

    const handleSuspend = () => {
        if (!detail?.summary) return;
        const reason = window.prompt(`Reason to suspend ${detail.summary.name}?`);
        if (!reason) return;
        guardedRun(async () => {
            await platformOrgsApi.suspend({ organizationId, reason });
            toast.success('Workspace suspended');
        });
    };

    const handleUnsuspend = () => {
        if (!detail?.summary) return;
        const reason = window.prompt(`Reason to unsuspend ${detail.summary.name}?`);
        if (!reason) return;
        guardedRun(async () => {
            await platformOrgsApi.unsuspend({ organizationId, reason });
            toast.success('Workspace unsuspended');
        });
    };

    const handleRestore = () => {
        if (!detail?.summary) return;
        const reason = window.prompt(`Reason to restore ${detail.summary.name}?`);
        if (!reason) return;
        guardedRun(async () => {
            await platformOrgsApi.restore({ organizationId, reason });
            toast.success('Workspace restored');
        });
    };

    const handleDelete = () => {
        if (!detail?.summary) return;
        const slug = detail.summary.slug;
        const confirm = window.prompt(`Type the slug "${slug}" to confirm deletion.`);
        if (confirm === null) return;
        if (confirm !== slug) {
            toast.error('Slug did not match');
            return;
        }
        const reason = window.prompt('Reason for deletion?');
        if (!reason) return;
        guardedRun(async () => {
            await platformOrgsApi.delete({
                organizationId,
                confirmSlug: confirm,
                reason,
            });
            toast.success('Workspace deleted. Owners notified.');
        });
    };

    const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
        { id: 'info', label: 'Info', icon: Info },
        { id: 'owners', label: 'Owners', icon: Crown },
    ];

    const summary = detail?.summary;
    const purgeAt = summary ? protoToDate(summary.purgeAt) : undefined;
    const lastActivity = summary ? protoToDate(summary.lastActivityAt) : undefined;
    const lastLogin = summary ? protoToDate(summary.lastLoginAt) : undefined;

    const renderInfoTab = () => {
        if (!summary || !detail) return null;
        return (
            <div className="space-y-4">
                {summary.deletedAt && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                            <Trash size={14} weight="duotone" />
                            Scheduled for deletion
                        </div>
                        {purgeAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                                Purge {formatRelativeTime(purgeAt.toISOString())}
                            </p>
                        )}
                        {detail.deletionReason && (
                            <p className="text-xs mt-2">
                                <span className="text-muted-foreground">Reason: </span>
                                {detail.deletionReason}
                            </p>
                        )}
                    </div>
                )}
                {summary.isSuspended && !summary.deletedAt && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                            <ShieldWarning size={14} weight="duotone" />
                            Suspended
                        </div>
                        {detail.suspensionReason && (
                            <p className="text-xs mt-2">
                                <span className="text-muted-foreground">Reason: </span>
                                {detail.suspensionReason}
                            </p>
                        )}
                    </div>
                )}

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
                    <p className="text-sm p-2 rounded-md bg-muted/50 break-all">{summary.name}</p>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Slug</label>
                    <p className="text-sm p-2 rounded-md bg-muted/50 font-mono">{summary.slug}</p>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Plan</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Tag size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm capitalize">{summary.plan}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Members</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <UsersIcon size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">{summary.memberCount}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Mail config</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Envelope size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm capitalize">{summary.mailConfigSource.replace('_', ' ')}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Encryption</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Key size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">
                            {summary.encryptionVersion > 0 ? `Active DEK v${summary.encryptionVersion}` : 'Not provisioned'}
                        </span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Created</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <Calendar size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">{formatProtoDateTime(summary.createdAt)}</span>
                    </div>
                </div>

                {lastActivity && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Last activity</label>
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                            <Clock size={16} weight="duotone" className="text-muted-foreground" />
                            <span className="text-sm">{formatRelativeTime(lastActivity.toISOString())}</span>
                        </div>
                    </div>
                )}

                {lastLogin && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Last login</label>
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                            <Clock size={16} weight="duotone" className="text-muted-foreground" />
                            <span className="text-sm">{formatRelativeTime(lastLogin.toISOString())}</span>
                        </div>
                    </div>
                )}

                {detail.domain && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Domain</label>
                        <p className="text-sm p-2 rounded-md bg-muted/50 font-mono">{detail.domain}</p>
                    </div>
                )}

                <div className="pt-2 flex flex-col gap-2">
                    {!summary.deletedAt && (
                        <Button
                            variant="default"
                            size="md"
                            className="w-full"
                            disabled={submitting}
                            onClick={() => setSupportOpen(true)}
                        >
                            <Lifebuoy size={14} weight="duotone" /> Enter support session
                        </Button>
                    )}
                    {summary.deletedAt ? (
                        <Button
                            variant="default"
                            size="md"
                            className="w-full"
                            disabled={submitting}
                            onClick={handleRestore}
                        >
                            <ArrowCounterClockwise size={14} weight="duotone" /> Restore
                        </Button>
                    ) : summary.isSuspended ? (
                        <Button
                            variant="default"
                            size="md"
                            className="w-full"
                            disabled={submitting}
                            onClick={handleUnsuspend}
                        >
                            <ArrowCounterClockwise size={14} weight="duotone" /> Unsuspend
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                size="md"
                                className="w-full"
                                disabled={submitting}
                                onClick={handleSuspend}
                            >
                                <Prohibit size={14} weight="duotone" /> Suspend
                            </Button>
                            <Button
                                variant="destructive"
                                size="md"
                                className="w-full"
                                disabled={submitting}
                                onClick={handleDelete}
                            >
                                <Trash size={14} weight="duotone" /> Delete
                            </Button>
                        </>
                    )}
                </div>
            </div>
        );
    };

    const renderOwnersTab = () => {
        if (!detail) return null;
        if (detail.owners.length === 0) {
            return (
                <div className="text-center py-8">
                    <Crown size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No active owners</p>
                </div>
            );
        }
        return (
            <div className="space-y-4">
                <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Owners ({detail.owners.length})
                    </h4>
                    <div className="space-y-2">
                        {detail.owners.map((owner) => (
                            <div key={owner.userId} className="p-2 rounded-md bg-muted/50">
                                <div className="flex items-center gap-2">
                                    <UserCircle size={16} weight="duotone" className="text-muted-foreground" />
                                    <span className="text-sm font-medium">
                                        {owner.fullName || owner.email}
                                    </span>
                                </div>
                                <div className="text-xs text-muted-foreground pl-6 mt-0.5">
                                    {owner.email}
                                </div>
                                <div className="text-xs text-muted-foreground pl-6">
                                    Joined {formatRelativeTime(
                                        protoToDate(owner.joinedAt)?.toISOString() ?? '',
                                    )}
                                </div>
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
            case 'owners':
                return renderOwnersTab();
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
                <div className="px-4 py-3 border-b border-border shrink-0 flex items-center gap-2 min-w-0">
                    <Buildings size={18} weight="duotone" className="text-blue-600 dark:text-blue-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">{summary.name}</div>
                        <code className="text-xs text-muted-foreground font-mono truncate block">{summary.slug}</code>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">{renderContent()}</div>

            {supportOpen && summary && (
                <RequestSupportSessionDialog
                    organizationId={organizationId}
                    organizationName={summary.name}
                    onClose={() => setSupportOpen(false)}
                    onCreated={() => {
                        refresh();
                        onChanged();
                    }}
                />
            )}
        </div>
    );
}
