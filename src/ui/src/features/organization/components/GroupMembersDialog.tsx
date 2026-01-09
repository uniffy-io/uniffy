import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { GroupInfo, GroupMemberInfo, UserInfoResponse } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";

interface GroupMembersDialogProps {
  group: GroupInfo;
  isOpen: boolean;
  onClose: () => void;
}

export function GroupMembersDialog({ group, isOpen, onClose }: GroupMembersDialogProps) {
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [users, setUsers] = useState<UserInfoResponse[]>([]); // For adding new members
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('member');
  const [showAddForm, setShowAddForm] = useState(false);
  
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (group && isOpen) {
      fetchMembers();
      fetchOrgUsers();
    }
  }, [group, isOpen]);

  const fetchMembers = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const client = createClient(AuthService, transport);
      const response = await client.listGroupMembers(
        { groupId: group.id, page: 1, pageSize: 100 },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setMembers(response.members);
    } catch (err) {
      console.error('Failed to fetch group members:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrgUsers = async () => {
    if (!accessToken || !group.organizationId) return;
    setLoadingUsers(true);
    try {
      const client = createClient(AuthService, transport);
      const response = await client.listOrganizationUsers(
        { organizationId: group.organizationId, page: 1, pageSize: 100 },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setUsers(response.users);
    } catch (err) {
      console.error('Failed to fetch organization users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !selectedUserId) return;
    
    try {
      const client = createClient(AuthService, transport);
      await client.addGroupMember(
        {
          groupId: group.id,
          userId: selectedUserId,
          role: selectedRole
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      await fetchMembers();
      setSelectedUserId('');
      setShowAddForm(false);
    } catch (err: any) {
      console.error('Failed to add member:', err);
      alert(`Failed to add member: ${err.message}`);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!accessToken || !confirm('Are you sure you want to remove this member?')) return;
    
    try {
      const client = createClient(AuthService, transport);
      await client.removeGroupMember(
        { groupId: group.id, userId },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      await fetchMembers();
    } catch (err: any) {
      console.error('Failed to remove member:', err);
      alert(`Failed to remove member: ${err.message}`);
    }
  };

  // Filter out users who are already members
  const availableUsers = users.filter(
    user => !members.some(member => member.userId === user.id)
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-10">
      <div className="bg-background w-full max-w-2xl rounded-lg shadow-lg border border-border p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Members: {group.name}</h2>
          <Button size="xs" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : 'Add Member'}
          </Button>
        </div>
        
        {showAddForm && (
          <form onSubmit={handleAddMember} className="mb-6 p-4 bg-muted/50 rounded-md border border-border">
            <h3 className="text-sm font-medium mb-3">Add User to Group</h3>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium mb-1">Select User</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                  className="w-full p-2 text-sm border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
                  disabled={loadingUsers}
                >
                  <option value="">Select a user...</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username} {user.email ? `(${user.email})` : ''}
                    </option>
                  ))}
                </select>
                {loadingUsers && <p className="text-xs text-muted-foreground mt-1">Loading users...</p>}
                {availableUsers.length === 0 && !loadingUsers && (
                  <p className="text-xs text-muted-foreground mt-1">No more users to add.</p>
                )}
              </div>
              <div className="w-32">
                <label className="block text-xs font-medium mb-1">Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full p-2 text-sm border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" size="sm" disabled={!selectedUserId}>Add</Button>
            </div>
          </form>
        )}

        <div className="border rounded-md overflow-hidden max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground uppercase font-medium sticky top-0">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Joined</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Loading members...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No members found
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.userId} className="hover:bg-accent/50">
                    <td className="px-4 py-2">
                      <div className="font-medium">{member.username}</div>
                      <div className="text-xs text-muted-foreground">{member.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${member.role === 'admin' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted text-muted-foreground border-transparent'}`}>
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="xs" onClick={() => handleRemoveMember(member.userId)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-6">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}