import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { GroupInfo, GroupMemberInfo, UserInfoResponse } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { XMarkIcon, UserPlusIcon, UserGroupIcon, TrashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { cn } from "@/utils/cn";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-background w-full max-w-3xl rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-muted/50 to-muted/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <UserGroupIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Group Members</h2>
              <p className="text-sm text-muted-foreground">{group.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              size="sm" 
              onClick={() => setShowAddForm(!showAddForm)}
              variant={showAddForm ? "outline" : "default"}
            >
              <UserPlusIcon className="h-4 w-4" />
              {showAddForm ? 'Cancel' : 'Add Member'}
            </Button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 hover:bg-muted transition-colors"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-5">
          {showAddForm && (
            <form onSubmit={handleAddMember} className="rounded-xl border border-border bg-gradient-to-br from-muted/30 to-muted/10 p-5 space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <UserPlusIcon className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-semibold">Add User to Group</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,auto] gap-3">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select User</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    required
                    disabled={loadingUsers}
                    className={cn(
                      "w-full px-3 py-2.5 text-sm border border-input bg-background rounded-lg",
                      "focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <option value="">Choose a user...</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username} {user.email ? `• ${user.email}` : ''}
                      </option>
                    ))}
                  </select>
                  {loadingUsers && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-primary"></span>
                      Loading users...
                    </p>
                  )}
                  {availableUsers.length === 0 && !loadingUsers && (
                    <p className="text-xs text-muted-foreground">All organization users are already members</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</label>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="w-full md:w-32 px-3 py-2.5 text-sm border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all capitalize"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" size="md" disabled={!selectedUserId || loadingUsers} className="w-full md:w-auto">
                    Add Member
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Members Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
                          <p className="text-sm text-muted-foreground">Loading members...</p>
                        </div>
                      </td>
                    </tr>
                  ) : members.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <UserGroupIcon className="h-12 w-12 text-muted-foreground/50" />
                          <p className="text-sm font-medium text-foreground">No members found</p>
                          <p className="text-xs text-muted-foreground">Add users to this group to get started</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    members.map((member) => (
                      <tr key={member.userId} className="group hover:bg-accent/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold",
                              member.role === 'admin'
                                ? "bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400"
                                : "bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 text-blue-600 dark:text-blue-400"
                            )}>
                              {member.username.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-foreground flex items-center gap-2">
                                {member.username}
                                {member.role === 'admin' && (
                                  <ShieldCheckIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">{member.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                            member.role === 'admin'
                              ? 'bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300'
                              : 'bg-muted text-muted-foreground'
                          )}>
                            {member.role}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-muted-foreground">
                            {new Date(member.joinedAt).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric' 
                            })}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button 
                            variant="ghost" 
                            size="xs" 
                            onClick={() => handleRemoveMember(member.userId)} 
                            className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 transition-opacity"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer Stats */}
          <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserGroupIcon className="h-4 w-4" />
              <span className="font-medium">{members.length}</span>
              <span>member{members.length !== 1 ? 's' : ''}</span>
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}