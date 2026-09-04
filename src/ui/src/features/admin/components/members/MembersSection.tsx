import { useEffect, useState, useRef } from "react";
import {
  Users,
  MagnifyingGlass,
  ShieldCheck,
  ShieldSlash,
  User,
  Trash,
  Warning,
  HardDrives,
  IdentificationCard,
  Wallet,
  UserPlus,
} from "@phosphor-icons/react";
import { createClient } from "@connectrpc/connect";
import { toast } from "sonner";
import { useOrgMembers } from "@/features/admin/hooks/useAdminHooks";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import { unaryTransport } from "@/config/api";
import type { SerializedMemberInfo } from "@/features/admin/store/adminSlice";
import { useAppSelector } from "@/app/hooks";
import { Select, type SelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { friendlyErrorMessage } from "@/config";
import { mfaClient } from "@/features/mfa/api/mfaApi";
import { MemberAgentQuotaDialog } from "@/features/admin/components/members/MemberAgentQuotaDialog";
import { MemberProfileDialog } from "@/features/admin/components/members/MemberProfileDialog";
import { SubjectAvatarById } from "@/components/subject";
import { InviteMemberDialog } from "@/features/admin/components/members/InviteMemberDialog";
import { InvitationsTable } from "@/features/admin/components/members/InvitationsTable";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableLoading,
  TableEmpty,
} from "@/components/ui/table";

const ROLE_OPTIONS: SelectOption<number>[] = [
  { value: OrganizationRole.ADMIN, label: "Admin" },
  { value: OrganizationRole.MEMBER, label: "Member" },
];

const ROLE_FILTER_OPTIONS: SelectOption<string>[] = [
  { value: "", label: "All roles" },
  { value: String(OrganizationRole.OWNER), label: "Owners" },
  { value: String(OrganizationRole.ADMIN), label: "Admins" },
  { value: String(OrganizationRole.MEMBER), label: "Members" },
];

interface MemberRowProps {
  member: SerializedMemberInfo;
  currentUserId: string | undefined;
  organizationId: string | null;
  onUpdateRole: (userId: string, role: number) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onInvalidateCaches: (userId: string, displayName: string) => Promise<void>;
}

function MemberRow({
  member,
  currentUserId,
  organizationId,
  onUpdateRole,
  onRemove,
  onInvalidateCaches,
}: MemberRowProps) {
  const [updating, setUpdating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [invalidatingCaches, setInvalidatingCaches] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showInvalidateCachesConfirm, setShowInvalidateCachesConfirm] = useState(false);
  const [showQuotaDialog, setShowQuotaDialog] = useState(false);
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [showMfaResetDialog, setShowMfaResetDialog] = useState(false);
  const [mfaResetting, setMfaResetting] = useState(false);

  const handleMfaReset = async (reason: string) => {
    if (!organizationId) return;
    setMfaResetting(true);
    try {
      await mfaClient.adminResetMfa({
        organizationId,
        targetUserId: member.userId,
        reason,
      });
      toast.success(
        `Two factor reset for ${member.displayName}. They will be signed out and prompted to enrol again.`,
      );
      setShowMfaResetDialog(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to reset MFA";
      toast.error(friendlyErrorMessage(raw) || raw);
    } finally {
      setMfaResetting(false);
    }
  };

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

  const handleInvalidateCaches = async () => {
    setInvalidatingCaches(true);
    try {
      await onInvalidateCaches(member.userId, member.displayName);
      setShowInvalidateCachesConfirm(false);
    } finally {
      setInvalidatingCaches(false);
    }
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

  const getRoleBadgeStyle = (role: number) => {
    switch (role) {
      case OrganizationRole.OWNER:
        return "bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300";
      case OrganizationRole.ADMIN:
        return "bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 dark:from-blue-950 dark:to-blue-900 dark:text-blue-300";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <>
      <TableRow className={removing ? "opacity-50" : ""}>
        <TableCell>
          <div className="flex items-center gap-3">
            <SubjectAvatarById
              userId={member.userId}
              displayName={member.displayName}
              avatarUrl={member.avatarUrl || undefined}
              size="lg"
            />
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{member.displayName}</p>
                {isCurrentUser && <span className="text-xs text-muted-foreground">(you)</span>}
              </div>
              <p className="text-xs text-muted-foreground">{member.email}</p>
            </div>
          </div>
        </TableCell>

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

        <TableCell align="center" className="hidden sm:table-cell">
          <span
            className="text-xs font-medium"
            style={member.isActive ? { color: "var(--status-success)" } : undefined}
          >
            {member.isActive ? "Active" : "Inactive"}
          </span>
        </TableCell>

        <TableCell align="right">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setShowProfileDialog(true)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60
                                opacity-0 group-hover:opacity-100 transition-all"
              title="Edit profile"
            >
              <IdentificationCard size={16} />
            </button>
            {!isOwner && !isCurrentUser && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQuotaDialog(true)}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60
                                    opacity-0 group-hover:opacity-100 transition-all"
                  title="Set agent spend quota"
                >
                  <Wallet size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowInvalidateCachesConfirm(true)}
                  disabled={invalidatingCaches}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60
                                    opacity-0 group-hover:opacity-100 transition-all
                                    disabled:opacity-50"
                  title="Invalidate local caches"
                >
                  <HardDrives size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowMfaResetDialog(true)}
                  disabled={mfaResetting}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60
                                    opacity-0 group-hover:opacity-100 transition-all
                                    disabled:opacity-50"
                  title="Reset two factor authentication"
                >
                  <ShieldSlash size={16} />
                </button>
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
              </>
            )}
          </div>
        </TableCell>
      </TableRow>

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

      <ConfirmDialog
        isOpen={showInvalidateCachesConfirm}
        onClose={() => setShowInvalidateCachesConfirm(false)}
        onConfirm={handleInvalidateCaches}
        title="Invalidate Local Caches"
        message={`This will invalidate all locally cached data for ${member.displayName} across all their devices. Their data will reload from the server on next login.`}
        confirmLabel="Invalidate"
        variant="danger"
        loading={invalidatingCaches}
      />

      <ReasonDialog
        isOpen={showMfaResetDialog}
        onClose={() => setShowMfaResetDialog(false)}
        onConfirm={handleMfaReset}
        title="Reset two factor authentication"
        description={
          <>
            This disables MFA on <strong>{member.email}</strong>, kills every active session, and
            sends them an out of band email if mail is configured. They will be guided through fresh
            enrollment on the next sign in.
          </>
        }
        reasonPlaceholder="Why are you resetting their MFA?"
        confirmLabel="Reset"
        variant="danger"
        loading={mfaResetting}
      />

      <MemberAgentQuotaDialog
        open={showQuotaDialog}
        userId={showQuotaDialog ? member.userId : null}
        displayName={member.displayName}
        onClose={() => setShowQuotaDialog(false)}
      />

      {showProfileDialog && (
        <MemberProfileDialog
          userId={member.userId}
          displayName={member.displayName}
          onClose={() => setShowProfileDialog(false)}
        />
      )}
    </>
  );
}

export function MembersSection() {
  const currentUser = useAppSelector((state) => state.auth.user);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const currentRole = useAppSelector((state) => state.auth.currentOrganizationRole);
  const isOrgAdmin = currentRole === "OWNER" || currentRole === "ADMIN";
  const { members, loading, totalCount, error, refresh, updateRole, remove } = useOrgMembers();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<number | undefined>(undefined);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitationsRefreshKey, setInvitationsRefreshKey] = useState(0);

  const prevSearchRef = useRef<string | undefined>(undefined);
  const prevRoleFilterRef = useRef<number | undefined>(undefined);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      prevSearchRef.current = search;
      prevRoleFilterRef.current = roleFilter;
      refresh({ search: search || undefined, roleFilter });
      return;
    }

    if (prevSearchRef.current === search && prevRoleFilterRef.current === roleFilter) {
      return;
    }

    prevSearchRef.current = search;
    prevRoleFilterRef.current = roleFilter;

    const timer = setTimeout(() => {
      refresh({ search: search || undefined, roleFilter });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable (useCallback with [dispatch])
  }, [search, roleFilter]);

  const handleInvalidateCaches = async (userId: string, displayName: string) => {
    const client = createClient(AuthService, unaryTransport);
    await client.rotateCacheKeySeed({ targetUserId: userId });
    toast.success(`Local caches invalidated for ${displayName}.`);
  };

  const ownerCount = members.filter((m) => m.role === OrganizationRole.OWNER).length;
  const adminCount = members.filter((m) => m.role === OrganizationRole.ADMIN).length;
  const memberCount = members.filter((m) => m.role === OrganizationRole.MEMBER).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Users size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Members</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Manage organization members and their roles.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="p-3 md:p-4 rounded-xl bg-surface shadow-edge">
          <p className="text-xl md:text-2xl font-bold">{totalCount}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Total Members</p>
        </div>
        <div className="p-3 md:p-4 rounded-xl bg-surface shadow-edge">
          <p className="text-xl md:text-2xl font-bold">{ownerCount + adminCount}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Administrators</p>
        </div>
        <div className="p-3 md:p-4 rounded-xl bg-surface shadow-edge">
          <p className="text-xl md:text-2xl font-bold">{memberCount}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Regular Members</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 md:gap-4">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="pl-9 pr-4"
          />
        </div>

        <Select
          value={roleFilter !== undefined ? String(roleFilter) : ""}
          onChange={(val) => setRoleFilter(val ? Number(val) : undefined)}
          options={ROLE_FILTER_OPTIONS}
          placeholder="All roles"
        />

        {isOrgAdmin && (
          <Button variant="default" onClick={() => setInviteOpen(true)} className="sm:ml-auto">
            <UserPlus size={16} weight="bold" />
            Invite member
          </Button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg border status-error">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>Member</TableHead>
            <TableHead align="center">Role</TableHead>
            <TableHead align="center" className="hidden sm:table-cell">
              Status
            </TableHead>
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
              title={
                search || roleFilter !== undefined
                  ? "No members match your filters"
                  : "No members found"
              }
            />
          ) : (
            members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                currentUserId={currentUser?.id}
                organizationId={organizationId}
                onUpdateRole={updateRole}
                onRemove={remove}
                onInvalidateCaches={handleInvalidateCaches}
              />
            ))
          )}
        </TableBody>
      </Table>

      {isOrgAdmin && organizationId && (
        <InvitationsTable organizationId={organizationId} refreshKey={invitationsRefreshKey} />
      )}

      {inviteOpen && organizationId && (
        <InviteMemberDialog
          organizationId={organizationId}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInvitationsRefreshKey((n) => n + 1);
            refresh({ search: search || undefined, roleFilter });
          }}
        />
      )}
    </div>
  );
}
