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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Add User
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          {error}
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground uppercase font-medium">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3 text-center">System Admin</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-accent/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{user.username}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.fullName || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {user.isSystemAdmin && (
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold border-transparent bg-primary text-primary-foreground">
                        Admin
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-red-500'}`} title={user.isActive ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="xs" onClick={() => handleEdit(user)}>
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
