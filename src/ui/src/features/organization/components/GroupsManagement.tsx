import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { GroupInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { GroupCreateDialog } from "./GroupCreateDialog";
import { GroupEditDialog } from "./GroupEditDialog";
import { GroupMembersDialog } from "./GroupMembersDialog";

export function GroupsManagement() {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupInfo | null>(null);
  const [managingMembersGroup, setManagingMembersGroup] = useState<GroupInfo | null>(null);
  
  const { accessToken, currentOrganizationId } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (accessToken && currentOrganizationId) {
      fetchGroups();
    }
  }, [accessToken, currentOrganizationId]);

  const fetchGroups = async () => {
    if (!accessToken || !currentOrganizationId) return;
    setLoading(true);
    try {
      const client = createClient(AuthService, transport);
      const response = await client.listGroups(
        { organizationId: currentOrganizationId, page: 1, pageSize: 100 },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setGroups(response.groups);
      setError(null);
    } catch (err: any) {
      console.error('Failed to list groups:', err);
      // Simple check for permission denied
      if (err.message?.includes("Requires organization admin")) {
          setError("You do not have permission to manage groups for this organization.");
      } else {
          setError('Failed to load groups');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!accessToken || !confirm('Are you sure you want to delete this group? This cannot be undone.')) return;
    
    try {
      const client = createClient(AuthService, transport);
      await client.deleteGroup(
        { groupId },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      await fetchGroups();
    } catch (err: any) {
      console.error('Failed to delete group:', err);
      alert(`Failed to delete group: ${err.message}`);
    }
  };

  if (!currentOrganizationId) {
    return <div className="p-4 text-muted-foreground">Please select an organization first.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-medium">Groups</h2>
          <p className="text-sm text-muted-foreground">Manage teams and channels within your organization.</p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Group
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          {error}
        </div>
      )}

      <div className="border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground uppercase font-medium">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-center">Visibility</th>
              <th className="px-4 py-3 text-center">Members</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading groups...
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No groups found. Create one to get started.
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <tr key={group.id} className="hover:bg-accent/50 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    {group.name}
                    {group.isDefault && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{group.slug}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{group.description || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {group.isPrivate ? (
                      <span className="inline-flex items-center text-xs text-muted-foreground">
                        <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Private
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs text-muted-foreground">
                        <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Public
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {group.memberCount}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Button variant="ghost" size="xs" onClick={() => setManagingMembersGroup(group)}>
                      Members
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setEditingGroup(group)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => handleDelete(group.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                      Delete
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <GroupCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSave={fetchGroups}
        organizationId={currentOrganizationId}
      />

      {editingGroup && (
        <GroupEditDialog
          group={editingGroup}
          isOpen={!!editingGroup}
          onClose={() => setEditingGroup(null)}
          onSave={fetchGroups}
        />
      )}

      {managingMembersGroup && (
        <GroupMembersDialog
          group={managingMembersGroup}
          isOpen={!!managingMembersGroup}
          onClose={() => setManagingMembersGroup(null)}
        />
      )}
    </div>
  );
}
