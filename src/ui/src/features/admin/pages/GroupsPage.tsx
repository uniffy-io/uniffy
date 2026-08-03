import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, UsersThree } from '@phosphor-icons/react';
import { GroupKind } from '@uniffy/proto/common/v1/common_pb';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useGroups } from '@/features/admin/hooks/useAdminHooks';
import type { SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { GroupDirectoryCard } from '@/features/admin/components/groups/GroupDirectoryCard';
import { GroupMembersModal } from '@/features/admin/components/groups/GroupMembersModal';
import {
    GroupFormModal,
    type GroupFormValues,
} from '@/features/admin/components/groups/GroupFormModal';

export function GroupsPage() {
    useDocumentTitle('Groups');

    const { groups, loading, refresh, create, update, remove } = useGroups();
    const [editingGroup, setEditingGroup] = useState<SerializedGroupInfo | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [viewingMembersGroup, setViewingMembersGroup] = useState<SerializedGroupInfo | null>(null);

    useEffect(() => {
        refresh({ includePrivate: true });
    }, [refresh]);

    const accessGroups = useMemo(
        () => groups.filter((group) => group.kind === GroupKind.ACCESS),
        [groups]
    );

    const handleCreate = async (values: GroupFormValues) => {
        await create({
            name: values.name,
            description: values.description,
            kind: GroupKind.ACCESS,
            isPrivate: values.isPrivate,
        });
    };

    const handleUpdate = async (values: GroupFormValues) => {
        if (editingGroup) {
            await update(editingGroup.id, values);
        }
    };

    return (
        <div className="space-y-6 w-full">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                        <UsersThree size={24} weight="duotone" className="text-primary shrink-0" />
                        <h1 className="text-xl md:text-2xl font-bold">Groups</h1>
                    </div>
                    <p className="text-muted-foreground text-sm">
                        An access group is a named grant list for sharing content with many members
                        at once. It has no org-chart meaning. When the set of people is an
                        organizational unit, prefer a{' '}
                        <Link to="/admin/teams" className="text-primary hover:underline">
                            team
                        </Link>
                        .
                    </p>
                </div>
                <Button size="md" className="shrink-0" onClick={() => setShowCreateModal(true)}>
                    <Plus size={16} />
                    <span className="hidden sm:inline">Create Group</span>
                </Button>
            </div>

            {loading ? (
                <div className="py-12 text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading groups...</p>
                </div>
            ) : accessGroups.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-border rounded-lg">
                    <UsersThree size={48} weight="duotone" className="mx-auto text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No groups yet</h3>
                    <p className="text-muted-foreground mb-4">
                        Create a group to share content with many members at once.
                    </p>
                    <Button size="md" onClick={() => setShowCreateModal(true)}>
                        <Plus size={16} />
                        Create your first group
                    </Button>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {accessGroups.map((group) => (
                        <GroupDirectoryCard
                            key={group.id}
                            group={group}
                            onEdit={setEditingGroup}
                            onDelete={remove}
                            onViewMembers={setViewingMembersGroup}
                        />
                    ))}
                </div>
            )}

            {showCreateModal && (
                <GroupFormModal
                    onSave={handleCreate}
                    onClose={() => setShowCreateModal(false)}
                />
            )}

            {editingGroup && (
                <GroupFormModal
                    group={editingGroup}
                    onSave={handleUpdate}
                    onClose={() => setEditingGroup(null)}
                />
            )}

            {viewingMembersGroup && (
                <GroupMembersModal
                    group={viewingMembersGroup}
                    onClose={() => setViewingMembersGroup(null)}
                />
            )}
        </div>
    );
}
