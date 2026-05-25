import { useState, useEffect, useCallback } from 'react';
import { createClient } from "@connectrpc/connect";
import { UsersService } from "@uniffy/proto/users/v1/users_pb";
import type { UserProfile } from "@uniffy/proto/users/v1/users_pb";
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
import { UserEditDialog } from "@/features/admin/components/UserEditDialog";
import { UserCreateDialog } from "@/features/admin/components/UserCreateDialog";
import { unaryTransport } from "@/config";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { UsersThree, Plus, PencilSimple, ShieldCheck } from '@phosphor-icons/react';
import { cn } from "@/shared/utils/cn";

export function UsersPage() {
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
      const client = createClient(UsersService, unaryTransport);
      const response = await client.listUsers(
        { pagination: { page: 1, pageSize: 100 }, includeInactive: true },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setUsers(response.users);
    } catch {
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
    <div className="flex flex-col gap-6 max-w-5xl w-full mx-auto">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <UsersThree size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all user accounts in the deployment.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)} className="shrink-0">
          <Plus size={14} />
          <span className="hidden sm:inline ml-1">Add user</span>
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--status-error) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--status-error) 5%, transparent)' }}>
          <p className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</p>
        </div>
      )}

      {/* Users Table */}
      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>User</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead className="hidden lg:table-cell">Full Name</TableHead>
            <TableHead align="center">Role</TableHead>
            <TableHead align="center" className="hidden sm:table-cell">Status</TableHead>
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
                <TableCell className="text-muted-foreground hidden md:table-cell">{user.email}</TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">{user.fullName || '-'}</TableCell>
                <TableCell align="center">
                  {user.isSystemAdmin && (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300">
                      Admin
                    </span>
                  )}
                </TableCell>
                <TableCell align="center" className="hidden sm:table-cell">
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: user.isActive ? 'var(--status-success)' : 'var(--status-error)' }} />
                    <span className="text-xs font-medium" style={{ color: user.isActive ? 'var(--status-success)' : 'var(--status-error)' }}>
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
