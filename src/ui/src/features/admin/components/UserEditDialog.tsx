import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { UserInfoResponse, AdminUserOrganizationInfo, AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { XMarkIcon, UserCircleIcon, BuildingOfficeIcon, PlusIcon, TrashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

interface UserEditDialogProps {
  user: UserInfoResponse;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function UserEditDialog({ user, isOpen, onClose, onSave }: UserEditDialogProps) {
  const [fullName, setFullName] = useState(user.fullName || '');
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [isActive, setIsActive] = useState(user.isActive);
  const [isSystemAdmin, setIsSystemAdmin] = useState(user.isSystemAdmin);
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  
  const [orgs, setOrgs] = useState<AdminUserOrganizationInfo[]>([]);
  const [allOrgs, setAllOrgs] = useState<AdminOrganizationInfo[]>([]);
  const [newOrgId, setNewOrgId] = useState('');
  const [newOrgRole, setNewOrgRole] = useState('member');
  
  const [loading, setLoading] = useState(false);
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchUserOrgs();
      fetchAllOrgs();
    }
  }, [isOpen, accessToken, user.id]);

  const fetchUserOrgs = async () => {
    try {
      const client = createClient(AuthService, transport);
      const response = await client.adminListUserOrganizations(
        { userId: user.id },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrgs(response.organizations);
    } catch (err) {
      console.error('Failed to fetch user organizations:', err);
    }
  };

  const fetchAllOrgs = async () => {
    try {
      const client = createClient(AuthService, transport);
      const response = await client.listAllOrganizations(
        { page: 1, pageSize: 100 }, 
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setAllOrgs(response.organizations);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);
    
    try {
      const client = createClient(AuthService, transport);
      await client.updateUser(
        {
          userId: user.id,
          fullName,
          username,
          email,
          isActive,
          isSystemAdmin,
          emailVerified
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      onSave();
      onClose();
    } catch (err) {
      console.error('Failed to update user:', err);
      alert('Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleAddOrg = async () => {
    if (!newOrgId || !accessToken) return;
    try {
      const client = createClient(AuthService, transport);
      await client.adminAddUserToOrganization(
        {
          userId: user.id,
          organizationId: newOrgId,
          role: newOrgRole
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setNewOrgId('');
      fetchUserOrgs();
    } catch (err) {
      console.error('Failed to add user to org:', err);
      alert('Failed to add user to organization');
    }
  };

  const handleRemoveOrg = async (orgId: string) => {
    if (!confirm('Are you sure?') || !accessToken) return;
    try {
      const client = createClient(AuthService, transport);
      await client.adminRemoveUserFromOrganization(
        {
          userId: user.id,
          organizationId: orgId
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      fetchUserOrgs();
    } catch (err) {
      console.error('Failed to remove user from org:', err);
      alert('Failed to remove user from organization');
    }
  };

  // Filter out organizations the user is already a member of
  const availableOrgs = allOrgs.filter(
    (org) => !orgs.some((userOrg) => userOrg.organizationId === org.id)
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-background w-full max-w-4xl rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200 my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <UserCircleIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Edit User</h2>
              <p className="text-xs text-muted-foreground">@{user.username}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-muted transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* User Details Form */}
            <form onSubmit={handleSave} className="space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <UserCircleIcon className="h-5 w-5 text-primary" />
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
                <label className="block text-sm font-semibold">Username *</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
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
                      <ShieldCheckIcon className="h-4 w-4 text-purple-600" />
                    </div>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      id="emailVerified"
                      checked={emailVerified}
                      onChange={(e) => setEmailVerified(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-medium group-hover:text-foreground">Email verified</span>
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
                <BuildingOfficeIcon className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Organizations</h3>
              </div>

              {/* Current Organizations */}
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {orgs.length === 0 ? (
                    <div className="p-6 text-center">
                      <BuildingOfficeIcon className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No organizations assigned</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {orgs.map((org) => (
                        <li key={org.organizationId} className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors group">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                              <BuildingOfficeIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <div className="font-semibold text-sm">{org.name}</div>
                              <div className="text-xs text-muted-foreground capitalize">{org.role}</div>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="xs" 
                            className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 transition-opacity"
                            onClick={() => handleRemoveOrg(org.organizationId)}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
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
                  <PlusIcon className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Add to Organization</h4>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">Organization</label>
                    <select
                      value={newOrgId}
                      onChange={(e) => setNewOrgId(e.target.value)}
                      className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    >
                      <option value="">Choose an organization...</option>
                      {availableOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name} • {org.slug}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</label>
                      <select
                        value={newOrgRole}
                        onChange={(e) => setNewOrgRole(e.target.value)}
                        className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all capitalize"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button onClick={handleAddOrg} disabled={!newOrgId} size="md" className="w-full">
                        <PlusIcon className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
