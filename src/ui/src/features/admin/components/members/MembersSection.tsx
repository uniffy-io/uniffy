/**
 * Members Section
 *
 * Admin UI for managing organization members.
 */

import { useEffect, useState, useRef } from 'react';
import {
    Users,
    MagnifyingGlass,
    ShieldCheck,
    User,
    Trash,
    Warning,
} from '@phosphor-icons/react';
import { useOrgMembers } from '@/features/admin/hooks/useAdminHooks';
import { OrganizationRole } from '@/gen/common/v1/common_pb';
import type { SerializedMemberInfo } from '@/features/admin/store/adminSlice';
import { useAppSelector } from '@/app/hooks';
import { Select, type SelectOption } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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

// Role options for the member role selector
const ROLE_OPTIONS: SelectOption<number>[] = [
    { value: OrganizationRole.ADMIN, label: 'Admin' },
    { value: OrganizationRole.MEMBER, label: 'Member' },
];

// Role filter options (includes "All roles")
const ROLE_FILTER_OPTIONS: SelectOption<string>[] = [
    { value: '', label: 'All roles' },
    { value: String(OrganizationRole.OWNER), label: 'Owners' },
    { value: String(OrganizationRole.ADMIN), label: 'Admins' },
    { value: String(OrganizationRole.MEMBER), label: 'Members' },
];

interface MemberRowProps {
    member: SerializedMemberInfo;
    currentUserId: string | undefined;
    onUpdateRole: (userId: string, role: number) => Promise<void>;
    onRemove: (userId: string) => Promise<void>;
}

function MemberRow({ member, currentUserId, onUpdateRole, onRemove }: MemberRowProps) {
    const [updating, setUpdating] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

    const isCurrentUser = member.userId === currentUserId;
    const isOwner = member.role === OrganizationRole.OWNER;

    const handleRoleChange = async (newRole: number) => {
        if (newRole === member.role) return;
        setUpdating(true);
        try {
            await onUpdateRole(member.userId, newRole);
        } finally {
            setUpdating(false);
        }
    };

    const handleRemoveClick = () => {
        setShowRemoveConfirm(true);
    };

    const handleRemoveConfirm = async () => {
        setRemoving(true);
        try {
            await onRemove(member.userId);
            setShowRemoveConfirm(false);
        } catch {
            setRemoving(false);
        }
    };

    // Get role badge style
    const getRoleBadgeStyle = (role: number) => {
        switch (role) {
            case OrganizationRole.OWNER:
                return 'bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300';
            case OrganizationRole.ADMIN:
                return 'bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 dark:from-blue-950 dark:to-blue-900 dark:text-blue-300';
            default:
                return 'bg-muted text-muted-foreground';
        }
    };

    return (
        <>
            <TableRow className={removing ? 'opacity-50' : ''}>
                {/* Member */}
                <TableCell>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                            {member.avatarUrl ? (
                                <img
                                    src={member.avatarUrl}
                                    alt={member.displayName}
                                    className="w-full h-full rounded-full object-cover"
                                />
                            ) : (
                                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                    {member.displayName.slice(0, 2).toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <p className="font-semibold text-foreground">{member.displayName}</p>
                                {isCurrentUser && (
                                    <span className="text-xs text-muted-foreground">(you)</span>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                    </div>
                </TableCell>

                {/* Role */}
                <TableCell align="center">
                    {isOwner ? (
                        <span
                            className={`
                                inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
                                ${getRoleBadgeStyle(member.role)}
                            `}
                        >
                            <ShieldCheck size={14} weight="fill" />
                            Owner
                        </span>
                    ) : (
                        <Select
                            value={member.role}
                            onChange={handleRoleChange}
                            options={ROLE_OPTIONS}
                            disabled={updating || isCurrentUser}
                            size="sm"
                        />
                    )}
                </TableCell>

                {/* Status */}
                <TableCell align="center">
                    <span
                        className="text-xs font-medium"
                        style={member.isActive ? { color: 'var(--status-success)' } : undefined}
                    >
                        {member.isActive ? 'Active' : 'Inactive'}
                    </span>
                </TableCell>

                {/* Actions */}
                <TableCell align="right">
                    {!isOwner && !isCurrentUser && (
                        <button
                            type="button"
                            onClick={handleRemoveClick}
                            disabled={removing}
                            className="p-2 rounded-md text-muted-foreground hover-destructive
                                opacity-0 group-hover:opacity-100 transition-all
                                disabled:opacity-50"
                            title="Remove from organization"
                        >
                            <Trash size={16} />
                        </button>
                    )}
                </TableCell>
            </TableRow>

            {/* Remove confirmation dialog */}
            <ConfirmDialog
                isOpen={showRemoveConfirm}
                onClose={() => setShowRemoveConfirm(false)}
                onConfirm={handleRemoveConfirm}
                title="Remove Member"
                message={`Are you sure you want to remove ${member.displayName} from the organization? They will lose access to all content.`}
                confirmLabel="Remove"
                variant="danger"
                loading={removing}
            />
        </>
    );
}

export function MembersSection() {
    const currentUser = useAppSelector((state) => state.auth.user);
    const { members, loading, totalCount, error, refresh, updateRole, remove } = useOrgMembers();
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<number | undefined>(undefined);

    // Track previous values to detect actual changes vs initial mount
    const prevSearchRef = useRef<string | undefined>(undefined);
    const prevRoleFilterRef = useRef<number | undefined>(undefined);
    const hasFetchedRef = useRef(false);

    // Fetch on mount and when filters change (debounced)
    useEffect(() => {
        // Initial fetch - immediate
        if (!hasFetchedRef.current) {
            hasFetchedRef.current = true;
            prevSearchRef.current = search;
            prevRoleFilterRef.current = roleFilter;
            refresh({ search: search || undefined, roleFilter });
            return;
        }

        // Check if values actually changed
        if (prevSearchRef.current === search && prevRoleFilterRef.current === roleFilter) {
            return;
        }

        // Update refs
        prevSearchRef.current = search;
        prevRoleFilterRef.current = roleFilter;

        // Debounce subsequent filter/search changes
        const timer = setTimeout(() => {
            refresh({ search: search || undefined, roleFilter });
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable (useCallback with [dispatch])
    }, [search, roleFilter]);

    // Count by role
    const ownerCount = members.filter((m) => m.role === OrganizationRole.OWNER).length;
    const adminCount = members.filter((m) => m.role === OrganizationRole.ADMIN).length;
    const memberCount = members.filter((m) => m.role === OrganizationRole.MEMBER).length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <Users size={24} weight="duotone" className="text-primary" />
                    <h1 className="text-2xl font-bold">Members</h1>
                </div>
                <p className="text-muted-foreground">
                    Manage organization members and their roles.
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border border-border bg-card">
                    <p className="text-2xl font-bold">{totalCount}</p>
                    <p className="text-sm text-muted-foreground">Total Members</p>
                </div>
                <div className="p-4 rounded-lg border border-border bg-card">
                    <p className="text-2xl font-bold">{ownerCount + adminCount}</p>
                    <p className="text-sm text-muted-foreground">Administrators</p>
                </div>
                <div className="p-4 rounded-lg border border-border bg-card">
                    <p className="text-2xl font-bold">{memberCount}</p>
                    <p className="text-sm text-muted-foreground">Regular Members</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4">
                {/* Search */}
                <div className="relative flex-1 max-w-sm">
                    <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or email..."
                        className="w-full pl-9 pr-4 py-2 rounded-md border border-border bg-background
                            text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>

                {/* Role filter */}
                <Select
                    value={roleFilter !== undefined ? String(roleFilter) : ''}
                    onChange={(val) => setRoleFilter(val ? Number(val) : undefined)}
                    options={ROLE_FILTER_OPTIONS}
                    placeholder="All roles"
                />
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 rounded-lg border status-error">
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--status-error)' }}>
                        <Warning size={20} weight="fill" />
                        {error}
                    </div>
                </div>
            )}

            {/* Members table */}
            <Table>
                <TableHeader>
                    <TableRow hoverable={false}>
                        <TableHead>Member</TableHead>
                        <TableHead align="center">Role</TableHead>
                        <TableHead align="center">Status</TableHead>
                        <TableHead align="right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableLoading colSpan={4} message="Loading members..." />
                    ) : members.length === 0 ? (
                        <TableEmpty
                            colSpan={4}
                            icon={<User size={48} weight="duotone" />}
                            title={search || roleFilter !== undefined
                                ? 'No members match your filters'
                                : 'No members found'}
                        />
                    ) : (
                        members.map((member) => (
                            <MemberRow
                                key={member.userId}
                                member={member}
                                currentUserId={currentUser?.id}
                                onUpdateRole={updateRole}
                                onRemove={remove}
                            />
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
}

