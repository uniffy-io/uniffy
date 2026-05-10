import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from "@connectrpc/connect";
import { UsersService } from "@uniffy/proto/users/v1/users_connect";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_connect";
import { UserProfile, UserOrganizationMembership } from "@uniffy/proto/users/v1/users_pb";
import { OrganizationDetail } from "@uniffy/proto/organizations/v1/organizations_pb";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { transport } from "@/config";
import { X, UserCircle, Buildings, Plus, Trash, ShieldCheck } from '@phosphor-icons/react';

// Role options for organization membership
const ORG_ROLE_OPTIONS: SelectOption<number>[] = [
    { value: OrganizationRole.MEMBER, label: 'Member' },
    { value: OrganizationRole.ADMIN, label: 'Admin' },
    { value: OrganizationRole.OWNER, label: 'Owner' },
];

interface UserEditDialogProps {
  user: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

function getRoleName(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return 'owner';
    case OrganizationRole.ADMIN:
      return 'admin';
    case OrganizationRole.MEMBER:
      return 'member';
    default:
      return 'member';
  }
}

export function UserEditDialog({ user, isOpen, onClose, onSave }: UserEditDialogProps) {
  const [fullName, setFullName] = useState(user.fullName || '');
  const [username, setUsername] = useState(user.username || '');
  const [email, setEmail] = useState(user.email);
  const [isActive, setIsActive] = useState(user.isActive);
  const [isSystemAdmin, setIsSystemAdmin] = useState(user.isSystemAdmin);

  const [orgs, setOrgs] = useState<UserOrganizationMembership[]>([]);
  const [allOrgs, setAllOrgs] = useState<OrganizationDetail[]>([]);
  const [newOrgId, setNewOrgId] = useState('');
  const [newOrgRole, setNewOrgRole] = useState<OrganizationRole>(OrganizationRole.MEMBER);

  const [loading, setLoading] = useState(false);
  const [removingOrgId, setRemovingOrgId] = useState<string | null>(null);
  const [removeOrgLoading, setRemoveOrgLoading] = useState(false);
  const accessToken = useAppSelector((state) => state.auth?.accessToken);

  const fetchUserOrgs = useCallback(async () => {
    try {
      const client = createClient(UsersService, transport);
      const response = await client.listUserOrganizations(
        { userId: user.id },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrgs(response.memberships);
    } catch {
      // failure leaves orgs empty; admin can retry
    }
  }, [accessToken, user.id]);

  const fetchAllOrgs = useCallback(async () => {
    try {
      const client = createClient(OrganizationsService, transport);
      const response = await client.listOrganizations(
        { pagination: { page: 1, pageSize: 100 } },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setAllOrgs(response.organizations);
    } catch {
      // failure leaves list empty; admin can retry
    }
  }, [accessToken]);

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchUserOrgs();
      fetchAllOrgs();
    }
  }, [isOpen, accessToken, user.id, fetchUserOrgs, fetchAllOrgs]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);

    try {
      const client = createClient(UsersService, transport);
      await client.updateUser(
        {
          userId: user.id,
          fullName: fullName || undefined,
          username: username || undefined,
          email,
          isActive,
          isSystemAdmin
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      onSave();
      onClose();
    } catch {
      alert('Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleAddOrg = async () => {
    if (!newOrgId || !accessToken) return;
    try {
      const client = createClient(UsersService, transport);
      await client.addUserToOrganization(
        {
          userId: user.id,
          organizationId: newOrgId,
          role: newOrgRole
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setNewOrgId('');
      fetchUserOrgs();
    } catch {
      alert('Failed to add user to organization');
    }
  };

  const handleRemoveOrgClick = (orgId: string) => {
    setRemovingOrgId(orgId);
  };

  const handleRemoveOrgConfirm = async () => {
    if (!removingOrgId || !accessToken) return;
    setRemoveOrgLoading(true);
    try {
      const client = createClient(UsersService, transport);
      await client.removeUserFromOrganization(
        {
          userId: user.id,
          organizationId: removingOrgId
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setRemovingOrgId(null);
      fetchUserOrgs();
    } catch {
      alert('Failed to remove user from organization');
    } finally {
      setRemoveOrgLoading(false);
    }
  };

  // Filter out organizations the user is already a member of
  const availableOrgs = allOrgs.filter(
    (org) => !orgs.some((userOrg) => userOrg.organization?.id === org.organization?.id)
  );

  // Build organization options for the select
  const orgOptions: SelectOption<string>[] = useMemo(() => [
    { value: '', label: 'Choose an organization...' },
    ...availableOrgs.map((org) => ({
      value: org.organization?.id || '',
      label: `${org.organization?.name} • ${org.organization?.slug}`,
    })),
  ], [availableOrgs]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-background w-full max-w-4xl rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200 my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <UserCircle size={20} weight="duotone" className="text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Edit User</h2>
              <p className="text-xs text-muted-foreground">@{user.username || user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-muted transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* User Details Form */}
            <form onSubmit={handleSave} className="space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <UserCircle size={20} weight="duotone" className="text-primary" />
                <h3 className="text-lg font-semibold">User Details</h3>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold">Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                />
              </div>

              <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
                <p className="text-sm font-semibold">User Permissions</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-medium group-hover:text-foreground">Active account</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      id="isSystemAdmin"
                      checked={isSystemAdmin}
                      onChange={(e) => setIsSystemAdmin(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium group-hover:text-foreground">System Administrator</span>
                      <ShieldCheck size={16} weight="fill" className="text-purple-600" />
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" size="md" onClick={onClose} disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={loading}>
                  {loading ? 'Saving...' : 'Save Details'}
                </Button>
              </div>
            </form>

            {/* Organizations Section */}
            <div className="space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <Buildings size={20} weight="duotone" className="text-primary" />
                <h3 className="text-lg font-semibold">Organizations</h3>
              </div>

              {/* Current Organizations */}
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {orgs.length === 0 ? (
                    <div className="p-6 text-center">
                      <Buildings size={40} weight="duotone" className="text-muted-foreground/50 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No organizations assigned</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {orgs.map((membership) => (
                        <li key={membership.organization?.id} className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors group">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                              <Buildings size={20} weight="duotone" className="text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <div className="font-semibold text-sm">{membership.organization?.name}</div>
                              <div className="text-xs text-muted-foreground capitalize">{getRoleName(membership.role)}</div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="opacity-0 group-hover:opacity-100 hover:opacity-90 transition-opacity"
                            style={{ color: 'var(--status-error)' }}
                            onClick={() => handleRemoveOrgClick(membership.organization?.id || '')}
                          >
                            <Trash size={14} />
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Add Organization Form */}
              <div className="rounded-xl border border-border bg-gradient-to-br from-muted/30 to-muted/10 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Plus size={16} className="text-primary" />
                  <h4 className="text-sm font-semibold">Add to Organization</h4>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">Organization</label>
                    <Select
                      value={newOrgId}
                      onChange={setNewOrgId}
                      options={orgOptions}
                      placeholder="Choose an organization..."
                      className="w-full"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</label>
                      <Select
                        value={newOrgRole}
                        onChange={(val) => setNewOrgRole(val as OrganizationRole)}
                        options={ORG_ROLE_OPTIONS}
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button onClick={handleAddOrg} disabled={!newOrgId} size="md" className="w-full">
                        <Plus size={16} />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Remove from organization confirmation dialog */}
        <ConfirmDialog
          isOpen={!!removingOrgId}
          onClose={() => setRemovingOrgId(null)}
          onConfirm={handleRemoveOrgConfirm}
          title="Remove from Organization"
          message={`Are you sure you want to remove ${user.fullName || user.email} from this organization?`}
          confirmLabel="Remove"
          variant="danger"
          loading={removeOrgLoading}
        />
      </div>
    </div>
  );
}
