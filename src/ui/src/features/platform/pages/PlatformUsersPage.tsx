import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    UsersThree,
    MagnifyingGlass,
    ShieldCheck,
    SignOut,
    DotsThreeVertical,
    CheckCircle,
    XCircle,
} from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer } from '@/components/ui/drawer';
import { PortalMenu } from '@/components/ui/portal-menu';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import {
    Table,
    TableBody,
    TableCell,
    TableEmpty,
    TableHead,
    TableHeader,
    TableLoading,
    TableRow,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { useAppSelector } from '@/app/hooks';
import { platformUsersApi } from '@/features/platform/api/systemDirectoryApi';
import { PlatformUserDetailPanel } from '@/features/platform/components/PlatformUserDetailPanel';
import type { PlatformUserSummary } from '@uniffy/proto/superadmin/v1/system_directory_pb';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

interface RowActionsProps {
    user: PlatformUserSummary;
    isSelf: boolean;
    onForceLogout: () => void;
    onToggleSystemAdmin: () => void;
}

function RowActions({ user, isSelf, onForceLogout, onToggleSystemAdmin }: RowActionsProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
        <>
            <Button
                ref={triggerRef}
                variant="ghost"
                size="xs"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                aria-label="Row actions"
            >
                <DotsThreeVertical size={16} weight="bold" />
            </Button>
            <PortalMenu open={open} onClose={() => setOpen(false)} triggerRef={triggerRef}>
                <button
                    type="button"
                    disabled={isSelf}
                    className={cn(
                        'w-full text-left px-3 py-1.5 flex items-center gap-2',
                        isSelf ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent',
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(false);
                        if (!isSelf) onForceLogout();
                    }}
                >
                    <SignOut size={14} weight="duotone" /> Force logout
                </button>
                <button
                    type="button"
                    disabled={isSelf && user.isSystemAdmin}
                    className={cn(
                        'w-full text-left px-3 py-1.5 flex items-center gap-2',
                        isSelf && user.isSystemAdmin
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-accent',
                        user.isSystemAdmin
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-purple-700 dark:text-purple-400',
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(false);
                        if (!(isSelf && user.isSystemAdmin)) onToggleSystemAdmin();
                    }}
                >
                    <ShieldCheck size={14} weight="duotone" />
                    {user.isSystemAdmin ? 'Revoke system admin' : 'Grant system admin'}
                </button>
            </PortalMenu>
        </>
    );
}

export function PlatformUsersPage() {
    useDocumentTitle('Platform Users');
    const { isMobileOrTablet } = useBreakpoint();
    const selfId = useAppSelector((state) => state.auth.user?.id);
    const [rows, setRows] = useState<PlatformUserSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [includeInactive, setIncludeInactive] = useState(false);
    const [onlySystemAdmins, setOnlySystemAdmins] = useState(false);
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const response = await platformUsersApi.list({
                page,
                pageSize: PAGE_SIZE,
                search,
                includeInactive,
                onlySystemAdmins,
            });
            setRows(response.users);
            setTotalCount(response.totalCount);
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [page, search, includeInactive, onlySystemAdmins]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const handleForceLogout = async (u: PlatformUserSummary) => {
        const reason = window.prompt(`Reason to force-logout ${u.email}?`);
        if (!reason) return;
        try {
            await platformUsersApi.forceLogout({ userId: u.id, reason });
            toast.success(`Forced logout: ${u.email}`);
            fetchRows();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        }
    };

    const handleToggleSystemAdmin = async (u: PlatformUserSummary) => {
        const action = u.isSystemAdmin ? 'revoke' : 'grant';
        const reason = window.prompt(`Reason to ${action} system admin for ${u.email}?`);
        if (!reason) return;
        try {
            await platformUsersApi.setSystemAdmin({
                userId: u.id,
                isSystemAdmin: !u.isSystemAdmin,
                reason,
            });
            toast.success(
                u.isSystemAdmin
                    ? `Revoked system admin from ${u.email}`
                    : `Granted system admin to ${u.email}`,
            );
            fetchRows();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        }
    };

    const pageInfo = useMemo(() => {
        const start = page * PAGE_SIZE;
        const end = Math.min(start + rows.length, totalCount);
        return totalCount > 0 ? `${start + 1}-${end} of ${totalCount}` : '0';
    }, [page, rows.length, totalCount]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const showInlinePanel = !!selectedId && !isMobileOrTablet;
    const showDrawerPanel = !!selectedId && isMobileOrTablet;

    return (
        <div className="flex gap-4 lg:gap-6 min-w-0">
            <div className="flex-1 min-w-0 flex flex-col gap-6">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <UsersThree size={22} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-semibold text-foreground">Users</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Cross-tenant user directory. Force-logout invalidates every JWT for the user.
                    </p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 relative">
                    <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(0);
                        }}
                        placeholder="Search by email, username, or name"
                        className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <Checkbox
                    label="System admins only"
                    checked={onlySystemAdmins}
                    onChange={(e) => {
                        setOnlySystemAdmins(e.target.checked);
                        setPage(0);
                    }}
                />
                <Checkbox
                    label="Include inactive"
                    checked={includeInactive}
                    onChange={(e) => {
                        setIncludeInactive(e.target.checked);
                        setPage(0);
                    }}
                />
            </div>

            <Table>
                <TableHeader>
                    <TableRow hoverable={false}>
                        <TableHead>User</TableHead>
                        <TableHead className="hidden md:table-cell">Email</TableHead>
                        <TableHead align="center">Orgs</TableHead>
                        <TableHead className="hidden lg:table-cell">Last login</TableHead>
                        <TableHead align="center" className="hidden sm:table-cell">Verified</TableHead>
                        <TableHead align="center">Role</TableHead>
                        <TableHead align="right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableLoading colSpan={7} message="Loading users..." />
                    ) : rows.length === 0 ? (
                        <TableEmpty
                            colSpan={7}
                            icon={<UsersThree size={48} weight="duotone" />}
                            title="No users match"
                            description={search ? 'Try a different search term' : 'No users in deployment yet.'}
                        />
                    ) : (
                        rows.map((u) => (
                            <TableRow
                                key={u.id}
                                onClick={() => setSelectedId(u.id)}
                                className="cursor-pointer"
                            >
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={cn(
                                                'h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                                                u.isSystemAdmin
                                                    ? 'bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400'
                                                    : 'bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 text-blue-600 dark:text-blue-400',
                                            )}
                                        >
                                            {(u.username || u.email).slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-foreground truncate">
                                                {u.fullName || u.username || u.email}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                @{u.username || u.email.split('@')[0]}
                                            </div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-muted-foreground truncate">
                                    {u.email}
                                </TableCell>
                                <TableCell align="center">
                                    <span className="inline-flex items-center justify-center min-w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold px-2">
                                        {u.orgMembershipsCount}
                                    </span>
                                </TableCell>
                                <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                                    {u.lastLoginAt
                                        ? formatRelativeTime(
                                              protoToDate(u.lastLoginAt)?.toISOString() ?? '',
                                          )
                                        : '-'}
                                </TableCell>
                                <TableCell align="center" className="hidden sm:table-cell">
                                    {u.emailVerified ? (
                                        <CheckCircle
                                            size={16}
                                            weight="fill"
                                            className="text-emerald-600 dark:text-emerald-400"
                                        />
                                    ) : (
                                        <XCircle size={16} className="text-muted-foreground" />
                                    )}
                                </TableCell>
                                <TableCell align="center">
                                    {u.isSystemAdmin ? (
                                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                                            <ShieldCheck size={10} weight="fill" />
                                            Sysadmin
                                        </span>
                                    ) : !u.isActive ? (
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                            Inactive
                                        </span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">Member</span>
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    <RowActions
                                        user={u}
                                        isSelf={u.id === selfId}
                                        onForceLogout={() => handleForceLogout(u)}
                                        onToggleSystemAdmin={() => handleToggleSystemAdmin(u)}
                                    />
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{pageInfo}</span>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="xs"
                        disabled={page <= 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                        Prev
                    </Button>
                    <span>
                        Page {page + 1} / {totalPages}
                    </span>
                    <Button
                        variant="ghost"
                        size="xs"
                        disabled={page + 1 >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </Button>
                </div>
            </div>

            </div>

            {showInlinePanel && (
                <aside className="w-[400px] xl:w-[440px] shrink-0">
                    <div className="sticky top-0 h-[calc(100dvh-12rem)] rounded-lg border border-border overflow-hidden">
                        <PlatformUserDetailPanel
                            userId={selectedId}
                            onClose={() => setSelectedId(null)}
                            onChanged={fetchRows}
                            selfId={selfId}
                        />
                    </div>
                </aside>
            )}

            {showDrawerPanel && (
                <Drawer
                    open
                    onClose={() => setSelectedId(null)}
                    side="right"
                    className="w-full sm:w-[400px]"
                    showClose={false}
                    ariaLabel="User details"
                >
                    <PlatformUserDetailPanel
                        userId={selectedId}
                        onClose={() => setSelectedId(null)}
                        onChanged={fetchRows}
                        selfId={selfId}
                    />
                </Drawer>
            )}
        </div>
    );
}
