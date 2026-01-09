import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";

interface UserCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function UserCreateDialog({ isOpen, onClose, onSave }: UserCreateDialogProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  
  const [orgId, setOrgId] = useState('');
  const [orgRole, setOrgRole] = useState('member');
  
  const [organizations, setOrganizations] = useState<AdminOrganizationInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchOrganizations();
    }
  }, [isOpen, accessToken]);

  const fetchOrganizations = async () => {
    try {
      const client = createClient(AuthService, transport);
      // Fetch reasonably large number of orgs for the dropdown
      // In a real app with many orgs, this should be an async search select
      const response = await client.listAllOrganizations(
        { page: 1, pageSize: 100 }, 
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrganizations(response.organizations);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  };

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);
    
    try {
      const client = createClient(AuthService, transport);
      await client.adminCreateUser(
        {
          fullName: fullName || undefined,
          username,
          email,
          password,
          isActive,
          isSystemAdmin,
          emailVerified,
          organizationId: orgId || undefined,
          organizationRole: orgId ? orgRole : undefined
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      onSave();
      onClose();
      // Reset form
      setFullName('');
      setUsername('');
      setEmail('');
      setPassword('');
      setIsActive(true);
      setIsSystemAdmin(false);
      setEmailVerified(false);
      setOrgId('');
      setOrgRole('member');
    } catch (err: any) {
      console.error('Failed to create user:', err);
      alert(`Failed to create user: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-10">
      <div className="bg-background w-full max-w-lg rounded-lg shadow-lg border border-border p-6 animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold mb-6">Create New User</h2>
        
        <form onSubmit={handleSave} className="space-y-4">
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
            <label className="block text-sm font-medium mb-1">Username *</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
          </div>
          
          <div className="space-y-2 pt-2">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="create-isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="create-isActive" className="text-sm font-medium">Active</label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="create-isSystemAdmin"
                checked={isSystemAdmin}
                onChange={(e) => setIsSystemAdmin(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="create-isSystemAdmin" className="text-sm font-medium">System Admin</label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="create-emailVerified"
                checked={emailVerified}
                onChange={(e) => setEmailVerified(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="create-emailVerified" className="text-sm font-medium">Email Verified</label>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <h4 className="text-sm font-medium mb-2">Initial Organization (Optional)</h4>
            <div className="space-y-2">
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-full p-2 border border-input bg-background rounded text-sm focus:ring-2 focus:ring-ring outline-none"
              >
                <option value="">Select an organization...</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.slug})
                  </option>
                ))}
              </select>
              <select
                value={orgRole}
                onChange={(e) => setOrgRole(e.target.value)}
                disabled={!orgId}
                className="w-full p-2 border border-input bg-background rounded text-sm focus:ring-2 focus:ring-ring outline-none disabled:opacity-50"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
