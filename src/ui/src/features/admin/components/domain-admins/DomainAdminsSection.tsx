/**
 * Domain Admins Section
 *
 * Admin UI for managing domain admin assignments.
 * Displays a filterable table of domain admins with grant/revoke actions.
 */

import { useEffect, useState } from 'react';
import {
    Crown,
    Plus,
    Trash,
    ChatCircle,
    FolderSimple,
    Note,
    CalendarBlank,
    Kanban,
    Robot,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useDomainAdmins, getDomainTypeLabel } from '@/features/admin/hooks/useAdminHooks';
import { DomainType } from '@uniffy/proto/common/v1/common_pb';
import type { SerializedDomainAdminInfo } from '@/features/admin/store/adminSlice';
import { SubjectAvatar } from '@/components/subject';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    TableLoading,
    TableEmpty,
} from '@/components/ui/table';
import { formatProtoDate } from '@/shared/utils/dateFormatting';
import { GrantDomainAdminDialog } from '@/features/admin/components/domain-admins/GrantDomainAdminDialog';

const DOMAIN_TABS = [
    { value: undefined, label: 'All' },
    { value: DomainType.CHAT, label: 'Chat' },
    { value: DomainType.FILES, label: 'Files' },
    { value: DomainType.NOTES, label: 'Notes' },
    { value: DomainType.CALENDAR, label: 'Calendar' },
    { value: DomainType.PROJECTS, label: 'Projects' },
    { value: DomainType.AGENTS, label: 'Agents' },
] as const;

const DOMAIN_BADGE_STYLES: Record<number, string> = {
    [DomainType.CHAT]: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
    [DomainType.FILES]: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    [DomainType.NOTES]: 'bg-primary/10 text-primary',
    [DomainType.CALENDAR]: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
    [DomainType.PROJECTS]: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    [DomainType.AGENTS]: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
};

const DOMAIN_ICONS: Record<number, React.ElementType> = {
    [DomainType.CHAT]: ChatCircle,
    [DomainType.FILES]: FolderSimple,
    [DomainType.NOTES]: Note,
    [DomainType.CALENDAR]: CalendarBlank,
    [DomainType.PROJECTS]: Kanban,
    [DomainType.AGENTS]: Robot,
};

function DomainBadge({ domain }: { domain: number }) {
    const Icon = DOMAIN_ICONS[domain];
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${DOMAIN_BADGE_STYLES[domain] || 'bg-muted text-muted-foreground'}`}>
            {Icon && <Icon className="h-3.5 w-3.5" weight="duotone" />}
            {getDomainTypeLabel(domain)} Admin
        </span>
    );
}

interface DomainAdminRowProps {
    admin: SerializedDomainAdminInfo;
    onRevoke: (userId: string, domain: number, displayName: string) => void;
}

function DomainAdminRow({ admin, onRevoke }: DomainAdminRowProps) {
    return (
        <TableRow>
            <TableCell>
                <div className="flex items-center gap-3">
                    <SubjectAvatar
                        subject={{
                            id: admin.userId,
                            name: admin.displayName,
                            email: admin.email,
                            type: 'user',
                            ...(admin.avatarUrl ? { avatarUrl: admin.avatarUrl } : {}),
                        }}
                        size="sm"
                    />
                    <div>
                        <p className="text-sm font-medium text-foreground">{admin.displayName}</p>
                        <p className="text-xs text-muted-foreground">{admin.email}</p>
                    </div>
                </div>
            </TableCell>
            <TableCell>
                <DomainBadge domain={admin.domain} />
            </TableCell>
            <TableCell className="hidden md:table-cell">
                <span className="text-sm text-muted-foreground">
                    {admin.grantedAt ? formatProtoDate(admin.grantedAt) : '-'}
                </span>
            </TableCell>
            <TableCell>
                <button
                    onClick={() => onRevoke(admin.userId, admin.domain, admin.displayName)}
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 md:opacity-0"
                    title="Revoke domain admin"
                >
                    <Trash className="h-4 w-4" />
                </button>
            </TableCell>
        </TableRow>
    );
}

export function DomainAdminsSection() {
    const { domainAdmins, loading, totalCount, refresh, grant, revoke } = useDomainAdmins();
    const [activeTab, setActiveTab] = useState<number | undefined>(undefined);
    const [showGrantDialog, setShowGrantDialog] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<{
        userId: string;
        domain: number;
        displayName: string;
    } | null>(null);

    useEffect(() => {
        refresh({ domainFilter: activeTab });
    }, [activeTab, refresh]);

    const handleGrant = async (userId: string, domain: number) => {
        await grant(userId, domain);
        toast.success('Domain admin granted');
    };

    const handleRevoke = async () => {
        if (!revokeTarget) return;
        await revoke(revokeTarget.userId, revokeTarget.domain);
        toast.success('Domain admin revoked');
        setRevokeTarget(null);
    };

    const filteredAdmins = activeTab !== undefined
        ? domainAdmins.filter((da) => da.domain === activeTab)
        : domainAdmins;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-foreground md:text-3xl">Domain Admins</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage elevated roles for specific application domains
                    </p>
                </div>
                <Button onClick={() => setShowGrantDialog(true)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Assign
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-2xl font-bold text-foreground">{totalCount}</p>
                    <p className="text-xs text-muted-foreground">Total assignments</p>
                </div>
                {[DomainType.CHAT, DomainType.FILES, DomainType.NOTES, DomainType.CALENDAR, DomainType.PROJECTS, DomainType.AGENTS].map((d) => {
                    const count = domainAdmins.filter((da) => da.domain === d).length;
                    if (count === 0 && activeTab !== undefined) return null;
                    const Icon = DOMAIN_ICONS[d];
                    return (
                        <div key={d} className="rounded-lg border border-border bg-card p-4">
                            <div className="flex items-center gap-2">
                                {Icon && <Icon className="h-4 w-4 text-muted-foreground" weight="duotone" />}
                                <p className="text-2xl font-bold text-foreground">{count}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">{getDomainTypeLabel(d)}</p>
                        </div>
                    );
                })}
            </div>

            {/* Domain filter tabs */}
            <div className="flex gap-1 overflow-x-auto border-b border-border">
                {DOMAIN_TABS.map((tab) => (
                    <button
                        key={tab.label}
                        onClick={() => setActiveTab(tab.value)}
                        className={`whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors ${
                            activeTab === tab.value
                                ? 'border-b-2 border-primary text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead className="hidden md:table-cell">Granted</TableHead>
                        <TableHead className="w-12" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableLoading colSpan={4} message="Loading domain admins..." />
                    ) : filteredAdmins.length === 0 ? (
                        <TableEmpty
                            colSpan={4}
                            icon={<Crown className="h-10 w-10" weight="duotone" />}
                            title="No domain admins"
                            description="Assign domain admin roles to give users elevated access within specific domains."
                            action={
                                <Button size="sm" onClick={() => setShowGrantDialog(true)}>
                                    <Plus className="mr-1.5 h-4 w-4" />
                                    Assign Domain Admin
                                </Button>
                            }
                        />
                    ) : (
                        filteredAdmins.map((da) => (
                            <DomainAdminRow
                                key={da.id}
                                admin={da}
                                onRevoke={(userId, domain, displayName) =>
                                    setRevokeTarget({ userId, domain, displayName })
                                }
                            />
                        ))
                    )}
                </TableBody>
            </Table>

            {/* Grant Dialog */}
            <GrantDomainAdminDialog
                open={showGrantDialog}
                onClose={() => setShowGrantDialog(false)}
                onGrant={handleGrant}
                preselectedDomain={activeTab}
            />

            {/* Revoke Confirmation */}
            <ConfirmDialog
                isOpen={!!revokeTarget}
                onClose={() => setRevokeTarget(null)}
                onConfirm={handleRevoke}
                title="Revoke domain admin?"
                message={`This will remove ${revokeTarget?.displayName}'s ${getDomainTypeLabel(revokeTarget?.domain ?? 0)} Admin role. They will lose elevated permissions in that domain.`}
                confirmLabel="Revoke"
                variant="danger"
            />
        </div>
    );
}
