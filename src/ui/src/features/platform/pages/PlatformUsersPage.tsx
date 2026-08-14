import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle,
  DotsThreeVertical,
  MagnifyingGlass,
  Prohibit,
  ShieldCheck,
  ShieldSlash,
  SignOut,
  UserPlus,
  UsersThree,
  XCircle,
} from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PortalMenu } from "@/components/ui/portal-menu";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { friendlyErrorMessage } from "@/config";
import { useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import { platformUsersApi } from "@/features/platform/api/systemDirectoryApi";
import { CreateUserDialog } from "@/features/platform/components/CreateUserDialog";
import { PlatformUserDetailDialog } from "@/features/platform/components/PlatformUserDetailDialog";
import { systemMfaClient } from "@/features/platform/api/systemMfaApi";
import { PeerResetInbox } from "@/features/mfa/components/PeerResetInbox";
import type { PlatformUserSummary } from "@uniffy/proto/superadmin/v1/system_directory_pb";

type PendingUserAction =
  | { kind: "force-logout"; user: PlatformUserSummary }
  | { kind: "toggle-admin"; user: PlatformUserSummary }
  | { kind: "mfa-reset-direct"; user: PlatformUserSummary }
  | { kind: "mfa-reset-peer"; user: PlatformUserSummary }
  | { kind: "toggle-active"; user: PlatformUserSummary };

interface ActionPrompt {
  title: string;
  description?: string;
  confirmLabel: string;
  variant: "danger" | "warning";
}

function promptFor(pending: PendingUserAction | null): ActionPrompt {
  if (!pending) return { title: "", confirmLabel: "Confirm", variant: "danger" };
  const { user } = pending;
  switch (pending.kind) {
    case "force-logout":
      return {
        title: `Force-logout ${user.email}?`,
        description: "Bumps the token version and invalidates every active JWT for this user.",
        confirmLabel: "Force logout",
        variant: "danger",
      };
    case "toggle-admin":
      return user.isSystemAdmin
        ? {
            title: `Revoke system admin from ${user.email}?`,
            description: "User loses access to /platform/* and is logged out everywhere.",
            confirmLabel: "Revoke",
            variant: "danger",
          }
        : {
            title: `Grant system admin to ${user.email}?`,
            description: "User gains access to /platform/* and is logged out everywhere.",
            confirmLabel: "Grant",
            variant: "warning",
          };
    case "toggle-active":
      return user.isActive
        ? {
            title: `Deactivate ${user.email}?`,
            description:
              "Blocks sign-in and kills every active session immediately. Org memberships are left in place, so reactivating restores the account as it was.",
            confirmLabel: "Deactivate",
            variant: "danger",
          }
        : {
            title: `Reactivate ${user.email}?`,
            description: "Restores sign-in. The account keeps whatever memberships it had.",
            confirmLabel: "Reactivate",
            variant: "warning",
          };
    case "mfa-reset-direct":
      return {
        title: `Reset MFA on ${user.email}?`,
        description:
          "Direct platform reset is only allowed for users with zero org memberships. The target is signed out everywhere and prompted to enrol again on next sign in.",
        confirmLabel: "Reset",
        variant: "danger",
      };
    case "mfa-reset-peer":
      return {
        title: `Request peer MFA reset for ${user.email}?`,
        description:
          "Opens a 10 minute peer co-sign window. Another platform admin (not you) must approve before MFA is actually reset.",
        confirmLabel: "Request reset",
        variant: "danger",
      };
  }
}

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
  if (!ts) return undefined;
  const ms = typeof ts.seconds === "bigint" ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
  return new Date(ms);
}

function RoleBadge({ user }: { user: PlatformUserSummary }) {
  if (user.isSystemAdmin) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300">
        <ShieldCheck size={12} weight="fill" />
        Sysadmin
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Member</span>;
}

function StatusBadge({ active }: { active: boolean }) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300">
        <XCircle size={12} weight="fill" />
        Inactive
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-emerald-100 to-emerald-200 text-emerald-700 dark:from-emerald-950 dark:to-emerald-900 dark:text-emerald-300">
      <CheckCircle size={12} weight="fill" />
      Active
    </span>
  );
}

interface RowActionsProps {
  user: PlatformUserSummary;
  isSelf: boolean;
  onForceLogout: () => void;
  onToggleSystemAdmin: () => void;
  onToggleActive: () => void;
  onResetMfaDirect: () => void;
  onRequestPeerMfaReset: () => void;
}

function RowActions({
  user,
  isSelf,
  onForceLogout,
  onToggleSystemAdmin,
  onToggleActive,
  onResetMfaDirect,
  onRequestPeerMfaReset,
}: RowActionsProps) {
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
            "w-full text-left px-3 py-1.5 flex items-center gap-2",
            isSelf ? "opacity-50 cursor-not-allowed" : "hover:bg-accent",
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
            "w-full text-left px-3 py-1.5 flex items-center gap-2",
            isSelf && user.isSystemAdmin ? "opacity-50 cursor-not-allowed" : "hover:bg-accent",
            user.isSystemAdmin
              ? "text-amber-700 dark:text-amber-400"
              : "text-purple-700 dark:text-purple-400",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            if (!(isSelf && user.isSystemAdmin)) onToggleSystemAdmin();
          }}
        >
          <ShieldCheck size={14} weight="duotone" />
          {user.isSystemAdmin ? "Revoke system admin" : "Grant system admin"}
        </button>
        <button
          type="button"
          disabled={isSelf}
          className={cn(
            "w-full text-left px-3 py-1.5 flex items-center gap-2",
            isSelf ? "opacity-50 cursor-not-allowed" : "hover:bg-accent",
            user.isActive
              ? "text-rose-700 dark:text-rose-400"
              : "text-emerald-700 dark:text-emerald-400",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            if (!isSelf) onToggleActive();
          }}
        >
          <Prohibit size={14} weight="duotone" />
          {user.isActive ? "Deactivate account" : "Reactivate account"}
        </button>
        {!isSelf && user.mfaEnabled && user.isSystemAdmin && (
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent text-rose-700 dark:text-rose-400"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRequestPeerMfaReset();
            }}
          >
            <ShieldSlash size={14} weight="duotone" /> Request peer MFA reset
          </button>
        )}
        {!isSelf && user.mfaEnabled && !user.isSystemAdmin && user.orgMembershipsCount === 0 && (
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent text-rose-700 dark:text-rose-400"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onResetMfaDirect();
            }}
          >
            <ShieldSlash size={14} weight="duotone" /> Reset MFA
          </button>
        )}
      </PortalMenu>
    </>
  );
}

interface UserStats {
  users: number;
  admins: number;
  inactive: number;
}

export function PlatformUsersPage() {
  useDocumentTitle("Platform Users");
  const selfId = useAppSelector((state) => state.auth.user?.id);
  const [rows, setRows] = useState<PlatformUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [onlySystemAdmins, setOnlySystemAdmins] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUserAction | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

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

  const fetchStats = useCallback(async () => {
    try {
      const [active, admins, withInactive] = await Promise.all([
        platformUsersApi.list({ page: 0, pageSize: 1 }),
        platformUsersApi.list({ page: 0, pageSize: 1, onlySystemAdmins: true }),
        platformUsersApi.list({ page: 0, pageSize: 1, includeInactive: true }),
      ]);
      setStats({
        users: active.totalCount,
        admins: admins.totalCount,
        inactive: Math.max(0, withInactive.totalCount - active.totalCount),
      });
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount and on every filter change; fetchRows raises the loading flag before awaiting the API
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; fetchStats only writes state after the await resolves
    fetchStats();
  }, [fetchStats]);

  const refreshAll = useCallback(() => {
    fetchRows();
    fetchStats();
  }, [fetchRows, fetchStats]);

  const runPending = async (reason: string) => {
    if (!pending) return;
    setPendingBusy(true);
    try {
      if (pending.kind === "force-logout") {
        await platformUsersApi.forceLogout({ userId: pending.user.id, reason });
        toast.success(`Forced logout: ${pending.user.email}`);
      } else if (pending.kind === "toggle-admin") {
        const wasAdmin = pending.user.isSystemAdmin;
        await platformUsersApi.setSystemAdmin({
          userId: pending.user.id,
          isSystemAdmin: !wasAdmin,
          reason,
        });
        toast.success(
          wasAdmin
            ? `Revoked system admin from ${pending.user.email}`
            : `Granted system admin to ${pending.user.email}`,
        );
      } else if (pending.kind === "toggle-active") {
        const wasActive = pending.user.isActive;
        await platformUsersApi.update({
          userId: pending.user.id,
          isActive: !wasActive,
          reason,
        });
        toast.success(
          wasActive ? `Deactivated ${pending.user.email}` : `Reactivated ${pending.user.email}`,
        );
      } else if (pending.kind === "mfa-reset-direct") {
        await systemMfaClient.resetUserMfa({
          targetUserId: pending.user.id,
          reason,
        });
        toast.success(`Two factor reset for ${pending.user.email}`);
      } else if (pending.kind === "mfa-reset-peer") {
        const response = await systemMfaClient.requestPeerReset({
          targetUserId: pending.user.id,
          reason,
        });
        toast.success(
          `Peer reset requested for ${pending.user.email}. Another platform admin has 10 minutes to approve (request ${response.requestId.slice(0, 8)}).`,
        );
      }
      setPending(null);
      refreshAll();
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setPendingBusy(false);
    }
  };

  const prompt = promptFor(pending);

  const pageInfo = useMemo(() => {
    const start = page * PAGE_SIZE;
    const end = Math.min(start + rows.length, totalCount);
    return totalCount > 0 ? `${start + 1}-${end} of ${totalCount}` : "0";
  }, [page, rows.length, totalCount]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <UsersThree size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Users</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Cross-tenant user directory. Force-logout invalidates every JWT for the user.
        </p>
      </div>

      <PeerResetInbox selfId={selfId} onApproved={refreshAll} />

      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="p-3 md:p-4 rounded-lg border border-border bg-card">
          <p className="text-xl md:text-2xl font-bold">{stats?.users ?? "-"}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Users</p>
        </div>
        <div className="p-3 md:p-4 rounded-lg border border-border bg-card">
          <p className="text-xl md:text-2xl font-bold">{stats?.admins ?? "-"}</p>
          <p className="text-xs md:text-sm text-muted-foreground">System admins</p>
        </div>
        <div className="p-3 md:p-4 rounded-lg border border-border bg-card">
          <p className="text-xl md:text-2xl font-bold">{stats?.inactive ?? "-"}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Inactive</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 md:gap-4">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search by email, username, or name..."
            className="w-full pl-9 pr-4 py-2 rounded-md border border-border bg-background
                            text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
        <Button variant="default" onClick={() => setCreateOpen(true)} className="sm:ml-auto">
          <UserPlus size={16} weight="bold" />
          New user
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>User</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead align="center">Orgs</TableHead>
            <TableHead className="hidden lg:table-cell">Last login</TableHead>
            <TableHead align="center" className="hidden sm:table-cell">
              Verified
            </TableHead>
            <TableHead align="center">Role</TableHead>
            <TableHead align="center">Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={8} message="Loading users..." />
          ) : rows.length === 0 ? (
            <TableEmpty
              colSpan={8}
              icon={<UsersThree size={48} weight="duotone" />}
              title="No users match"
              description={search ? "Try a different search term" : "No users in deployment yet."}
            />
          ) : (
            rows.map((u) => (
              <TableRow key={u.id} onClick={() => setSelectedId(u.id)} className="cursor-pointer">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <SubjectAvatarById
                      userId={u.id}
                      displayName={u.fullName || u.username || u.email}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground truncate">
                        {u.fullName || u.username || u.email}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        @{u.username || u.email.split("@")[0]}
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
                    ? formatRelativeTime(protoToDate(u.lastLoginAt)?.toISOString() ?? "")
                    : "-"}
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
                  <RoleBadge user={u} />
                </TableCell>
                <TableCell align="center">
                  <StatusBadge active={u.isActive} />
                </TableCell>
                <TableCell align="right">
                  <RowActions
                    user={u}
                    isSelf={u.id === selfId}
                    onForceLogout={() => setPending({ kind: "force-logout", user: u })}
                    onToggleSystemAdmin={() => setPending({ kind: "toggle-admin", user: u })}
                    onToggleActive={() => setPending({ kind: "toggle-active", user: u })}
                    onResetMfaDirect={() => setPending({ kind: "mfa-reset-direct", user: u })}
                    onRequestPeerMfaReset={() => setPending({ kind: "mfa-reset-peer", user: u })}
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

      {selectedId && (
        <PlatformUserDetailDialog
          userId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refreshAll}
          selfId={selfId}
        />
      )}

      {createOpen && (
        <CreateUserDialog onClose={() => setCreateOpen(false)} onCreated={refreshAll} />
      )}

      <ReasonDialog
        isOpen={!!pending}
        onClose={() => {
          if (!pendingBusy) setPending(null);
        }}
        onConfirm={runPending}
        title={prompt.title}
        description={prompt.description}
        confirmLabel={prompt.confirmLabel}
        variant={prompt.variant}
        loading={pendingBusy}
      />
    </div>
  );
}
