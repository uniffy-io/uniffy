import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from "@connectrpc/connect";
import { UsersService } from "@/gen/users/v1/users_connect";
import { OrganizationsService } from "@/gen/organizations/v1/organizations_connect";
import { OrganizationDetail } from "@/gen/organizations/v1/organizations_pb";
import { OrganizationRole } from "@/gen/common/v1/common_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { transport } from "@/config";
import { XMarkIcon } from '@heroicons/react/24/outline';

// Role options for organization membership
const ORG_ROLE_OPTIONS: SelectOption<number>[] = [
    { value: OrganizationRole.MEMBER, label: 'Member' },
    { value: OrganizationRole.ADMIN, label: 'Admin' },
    { value: OrganizationRole.OWNER, label: 'Owner' },
];

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
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  const [orgId, setOrgId] = useState('');
  const [orgRole, setOrgRole] = useState<OrganizationRole>(OrganizationRole.MEMBER);

  const [organizations, setOrganizations] = useState<OrganizationDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const accessToken = useAppSelector((state) => state.auth?.accessToken);

  const fetchOrganizations = useCallback(async () => {
    try {
      const client = createClient(OrganizationsService, transport);
      const response = await client.listOrganizations(
        { pagination: { page: 1, pageSize: 100 } },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrganizations(response.organizations);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  }, [accessToken]);

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchOrganizations();
    }
  }, [isOpen, accessToken, fetchOrganizations]);

  // Build organization options for the select
  const orgOptions: SelectOption<string>[] = useMemo(() => [
    { value: '', label: 'Select an organization...' },
    ...organizations.map((org) => ({
      value: org.organization?.id || '',
      label: `${org.organization?.name} (${org.organization?.slug})`,
    })),
  ], [organizations]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);

    try {
      const usersClient = createClient(UsersService, transport);

      // Create the user
      const newUser = await usersClient.createUser(
        {
          fullName: fullName || undefined,
          username: username || undefined,
          email,
          password,
          isSystemAdmin
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // If an organization is selected, add the user to it
      if (orgId && newUser.id) {
        await usersClient.addUserToOrganization(
          {
            userId: newUser.id,
            organizationId: orgId,
            role: orgRole
          },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
      }

      onSave();
      onClose();
      // Reset form
      setFullName('');
      setUsername('');
      setEmail('');
      setPassword('');
      setIsSystemAdmin(false);
      setOrgId('');
      setOrgRole(OrganizationRole.MEMBER);
    } catch (err: unknown) {
      console.error('Failed to create user:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to create user: ${message}`);
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
                  id="create-isSystemAdmin"
                  checked={isSystemAdmin}
                  onChange={(e) => setIsSystemAdmin(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium group-hover:text-foreground">System Administrator</span>
              </label>
            </div>
          </div>

          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
            <p className="text-sm font-semibold">Initial Organization (Optional)</p>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Organization</label>
                <Select
                  value={orgId}
                  onChange={setOrgId}
                  options={orgOptions}
                  placeholder="Select an organization..."
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Role</label>
                <Select
                  value={orgRole}
                  onChange={(val) => setOrgRole(val as OrganizationRole)}
                  options={ORG_ROLE_OPTIONS}
                  disabled={!orgId}
                  className="w-full"
                />
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
