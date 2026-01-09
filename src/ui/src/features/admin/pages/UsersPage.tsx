import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { UserInfoResponse } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { UserEditDialog } from "../components/UserEditDialog";
import { UserCreateDialog } from "../components/UserCreateDialog";
import { transport } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { UserGroupIcon, PlusIcon, PencilSquareIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { cn } from "@/utils/cn";

export default function UsersPage() {
  useDocumentTitle('Users');
  const [users, setUsers] = useState<UserInfoResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserInfoResponse | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    fetchUsers();
  }, [accessToken]);

  const fetchUsers = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const client = createClient(AuthService, transport);
      const response = await client.listAllUsers(
        { page: 1, pageSize: 100 }, // Fetch all for now
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setUsers(response.users);
    } catch (err: any) {
      console.error('Failed to list users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (user: UserInfoResponse) => {
    setEditingUser(user);
  };

  const handleSave = () => {
    fetchUsers();
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary p-3 shadow-lg">
            <UserGroupIcon className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage all user accounts in the system
            </p>
          </div>
        </div>
        <Button size="md" onClick={() => setIsCreateOpen(true)}>
          <PlusIcon className="h-4 w-4" />
          Add User
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 p-4">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Users Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Full Name</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
                      <p className="text-sm text-muted-foreground">Loading users...</p>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <UserGroupIcon className="h-12 w-12 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground">No users found</p>
                      <p className="text-xs text-muted-foreground">Create your first user to get started</p>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr 
                    key={user.id} 
                    className="group hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold",
                          user.isSystemAdmin 
                            ? "bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400"
                            : "bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 text-blue-600 dark:text-blue-400"
                        )}>
                          {user.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground flex items-center gap-2">
                            {user.username}
                            {user.isSystemAdmin && (
                              <ShieldCheckIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{user.email}</td>
                    <td className="px-6 py-4 text-muted-foreground">{user.fullName || '-'}</td>
                    <td className="px-6 py-4 text-center">
                      {user.isSystemAdmin && (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className={cn(
                          "h-2 w-2 rounded-full animate-pulse",
                          user.isActive ? "bg-green-500" : "bg-red-500"
                        )} />
                        <span className={cn(
                          "text-xs font-medium",
                          user.isActive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        )}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="ghost" 
                        size="xs" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(user);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <UserEditDialog
          user={editingUser}
          isOpen={!!editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleSave}
        />
      )}

      <UserCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
