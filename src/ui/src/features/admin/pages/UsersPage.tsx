import { useState, useEffect, useCallback } from 'react';
import { createClient } from "@connectrpc/connect";
import { UsersService } from "@/gen/users/v1/users_connect";
import { UserProfile } from "@/gen/users/v1/users_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
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
import { UserEditDialog } from "../components/UserEditDialog";
import { UserCreateDialog } from "../components/UserCreateDialog";
import { transport } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { UsersThree, Plus, PencilSimple, ShieldCheck } from '@phosphor-icons/react';
import { cn } from "@/utils/cn";

export default function UsersPage() {
  useDocumentTitle('Users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { accessToken } = useAppSelector((state) => state.auth);

  const fetchUsers = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const client = createClient(UsersService, transport);
      const response = await client.listUsers(
        { pagination: { page: 1, pageSize: 100 }, includeInactive: true },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setUsers(response.users);
    } catch (err: unknown) {
      console.error('Failed to list users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleEdit = (user: UserProfile) => {
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
            <UsersThree size={28} weight="duotone" className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage all user accounts in the system
            </p>
          </div>
        </div>
        <Button size="md" onClick={() => setIsCreateOpen(true)}>
          <Plus size={16} />
          Add User
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 p-4">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Users Table */}
      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>User</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Full Name</TableHead>
            <TableHead align="center">Role</TableHead>
            <TableHead align="center">Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={6} message="Loading users..." />
          ) : users.length === 0 ? (
            <TableEmpty
              colSpan={6}
              icon={<UsersThree size={48} weight="duotone" />}
              title="No users found"
              description="Create your first user to get started"
            />
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold",
                      user.isSystemAdmin
                        ? "bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400"
                        : "bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 text-blue-600 dark:text-blue-400"
                    )}>
                      {(user.username || user.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-foreground flex items-center gap-2">
                        {user.username || user.email}
                        {user.isSystemAdmin && (
                          <ShieldCheck size={16} weight="fill" className="text-purple-600 dark:text-purple-400" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">@{user.username || user.email.split('@')[0]}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell className="text-muted-foreground">{user.fullName || '-'}</TableCell>
                <TableCell align="center">
                  {user.isSystemAdmin && (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300">
                      Admin
                    </span>
                  )}
                </TableCell>
                <TableCell align="center">
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
                </TableCell>
                <TableCell align="right">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(user);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <PencilSimple size={14} />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

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
