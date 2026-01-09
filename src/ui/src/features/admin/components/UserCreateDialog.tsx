import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { XMarkIcon } from '@heroicons/react/24/outline';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-background w-full max-w-lg rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200 my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <h2 className="text-xl font-bold">Create New User</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-muted transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        
        {/* Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                placeholder="John Doe"
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
                placeholder="johndoe"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="john@example.com"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="••••••••"
            />
            <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
          </div>
          
          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
            <p className="text-sm font-semibold">User Permissions</p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  id="create-isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium group-hover:text-foreground">Active account</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  id="create-isSystemAdmin"
                  checked={isSystemAdmin}
                  onChange={(e) => setIsSystemAdmin(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium group-hover:text-foreground">System Administrator</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  id="create-emailVerified"
                  checked={emailVerified}
                  onChange={(e) => setEmailVerified(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium group-hover:text-foreground">Email verified</span>
              </label>
            </div>
          </div>

          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
            <p className="text-sm font-semibold">Initial Organization (Optional)</p>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Organization</label>
                <select
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                >
                  <option value="">Select an organization...</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.slug})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Role</label>
                <select
                  value={orgRole}
                  onChange={(e) => setOrgRole(e.target.value)}
                  disabled={!orgId}
                  className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed capitalize"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="md" disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
