import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { UserInfoResponse, AdminUserOrganizationInfo, AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-10">
      <div className="bg-background w-full max-w-2xl rounded-lg shadow-lg border border-border p-6 animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold mb-6">Edit User: {user.username}</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <form onSubmit={handleSave} className="space-y-4">
            <h3 className="text-lg font-semibold">Details</h3>
            <div>
              <label className="block text-sm font-medium mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
              />
            </div>
            
            <div className="space-y-2 pt-2">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="isActive" className="text-sm font-medium">Active</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isSystemAdmin"
                  checked={isSystemAdmin}
                  onChange={(e) => setIsSystemAdmin(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="isSystemAdmin" className="text-sm font-medium">System Admin</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="emailVerified"
                  checked={emailVerified}
                  onChange={(e) => setEmailVerified(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="emailVerified" className="text-sm font-medium">Email Verified</label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                Save Details
              </Button>
            </div>
          </form>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Organizations</h3>
            <div className="border rounded-md overflow-hidden max-h-60 overflow-y-auto">
              {orgs.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No organizations assigned</div>
              ) : (
                <ul className="divide-y divide-border">
                  {orgs.map((org) => (
                    <li key={org.organizationId} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-medium">{org.name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{org.role}</div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="xs" 
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleRemoveOrg(org.organizationId)}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-4 border-t border-border">
              <h4 className="text-sm font-medium mb-2">Add to Organization</h4>
              <div className="space-y-2">
                <select
                  value={newOrgId}
                  onChange={(e) => setNewOrgId(e.target.value)}
                  className="w-full p-2 border border-input bg-background rounded text-sm focus:ring-2 focus:ring-ring outline-none"
                >
                  <option value="">Select an organization...</option>
                  {availableOrgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.slug})
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <select
                    value={newOrgRole}
                    onChange={(e) => setNewOrgRole(e.target.value)}
                    className="flex-1 p-2 border border-input bg-background rounded text-sm focus:ring-2 focus:ring-ring outline-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                  <Button onClick={handleAddOrg} disabled={!newOrgId} size="sm">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
