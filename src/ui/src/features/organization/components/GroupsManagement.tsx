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
import { UserGroupIcon, PlusIcon, LockClosedIcon, GlobeAltIcon, PencilSquareIcon, TrashIcon, UsersIcon } from '@heroicons/react/24/outline';
import { cn } from "@/utils/cn";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch (err: unknown) {
      console.error('Failed to list groups:', err);
      // Simple check for permission denied
      const message = err instanceof Error ? err.message : '';
      if (message.includes("Requires organization admin")) {
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
    } catch (err: unknown) {
      console.error('Failed to delete group:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to delete group: ${message}`);
    }
  };

  if (!currentOrganizationId) {
    return <div className="p-4 text-muted-foreground">Please select an organization first.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <UserGroupIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Groups</h2>
            <p className="text-sm text-muted-foreground">Manage teams and channels within your organization</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <PlusIcon className="h-4 w-4" />
          Create Group
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 p-4">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Slug</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Visibility</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Members</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
                      <p className="text-sm text-muted-foreground">Loading groups...</p>
                    </div>
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <UserGroupIcon className="h-12 w-12 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground">No groups found</p>
                      <p className="text-xs text-muted-foreground">Create your first group to get started</p>
                    </div>
                  </td>
                </tr>
              ) : (
                groups.map((group) => (
                  <tr key={group.id} className="group hover:bg-accent/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-10 w-10 rounded-lg flex items-center justify-center",
                          group.isPrivate 
                            ? "bg-purple-500/20 border border-purple-500/30"
                            : "bg-blue-500/20 border border-blue-500/30"
                        )}>
                          {group.isPrivate ? (
                            <LockClosedIcon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          ) : (
                            <GlobeAltIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground flex items-center gap-2">
                            {group.name}
                            {group.isDefault && (
                              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary border border-primary/20">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">#{group.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="px-2 py-1 rounded bg-muted text-xs font-mono">{group.slug}</code>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground max-w-xs truncate">{group.description || '-'}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        group.isPrivate
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      )}>
                        {group.isPrivate ? (
                          <><LockClosedIcon className="h-3 w-3 mr-1" />Private</>
                        ) : (
                          <><GlobeAltIcon className="h-3 w-3 mr-1" />Public</>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                        {group.memberCount}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="xs" onClick={() => setManagingMembersGroup(group)}>
                          <UsersIcon className="h-3.5 w-3.5" />
                          Members
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setEditingGroup(group)}>
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => handleDelete(group.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20">
                          <TrashIcon className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
