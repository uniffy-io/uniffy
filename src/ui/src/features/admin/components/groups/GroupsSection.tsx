/**
 * Groups Section
 *
 * Admin UI for managing organization groups.
 */

import { useEffect, useState } from 'react';
import {
    UsersThree,
    Plus,
    Pencil,
    Trash,
    Users,
    X,
} from '@phosphor-icons/react';
import { useGroups, useGroupMembers } from '@/features/admin/hooks/useAdminHooks';
import type { SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface GroupCardProps {
    group: SerializedGroupInfo;
    onEdit: (group: SerializedGroupInfo) => void;
    onDelete: (groupId: string) => void;
    onViewMembers: (group: SerializedGroupInfo) => void;
}

function GroupCard({ group, onEdit, onDelete, onViewMembers }: GroupCardProps) {
    const [deleting, setDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleDeleteClick = () => {
        setShowDeleteConfirm(true);
    };

    const handleDeleteConfirm = async () => {
        setDeleting(true);
        try {
            await onDelete(group.id);
            setShowDeleteConfirm(false);
        } catch {
            setDeleting(false);
        }
    };

    return (
        <div className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10 flex-shrink-0">
                    <UsersThree size={20} weight="duotone" className="text-violet-600 dark:text-violet-400" />
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{group.name}</h3>
                    {group.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {group.description}
                        </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Users size={14} />
                            {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                        </span>
                        {group.createdAt && (
                            <span>
                                Created {new Date(Number(group.createdAt.seconds) * 1000).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onViewMembers(group)}
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="View members"
                    >
                        <Users size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => onEdit(group)}
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Edit group"
                    >
                        <Pencil size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={handleDeleteClick}
                        disabled={deleting}
                        className="p-2 rounded-md text-muted-foreground hover-destructive transition-colors disabled:opacity-50"
                        title="Delete group"
                    >
                        <Trash size={16} />
                    </button>
                </div>
            </div>

            {/* Delete confirmation dialog */}
            <ConfirmDialog
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={handleDeleteConfirm}
                title="Delete Group"
                message={`Are you sure you want to delete "${group.name}"? This cannot be undone.`}
                confirmLabel="Delete"
                variant="danger"
                loading={deleting}
            />
        </div>
    );
}

interface GroupFormModalProps {
    group?: SerializedGroupInfo | null;
    onSave: (name: string, description: string) => Promise<void>;
    onClose: () => void;
}

function GroupFormModal({ group, onSave, onClose }: GroupFormModalProps) {
    const [name, setName] = useState(group?.name || '');
    const [description, setDescription] = useState(group?.description || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            await onSave(name.trim(), description.trim());
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save group');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-semibold">
                        {group ? 'Edit Group' : 'Create Group'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <X size={20} weight="bold" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 rounded-md text-sm status-error">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Engineering Team"
                            className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional description..."
                            rows={3}
                            className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground
                                hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 rounded-md text-sm font-medium
                                bg-primary text-primary-foreground hover:bg-primary/90
                                disabled:opacity-50 transition-colors"
                        >
                            {saving ? 'Saving...' : group ? 'Save Changes' : 'Create Group'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

interface GroupMembersModalProps {
    group: SerializedGroupInfo;
    onClose: () => void;
}

function GroupMembersModal({ group, onClose }: GroupMembersModalProps) {
    const { members, loading, remove } = useGroupMembers(group.id);
    const [removing, setRemoving] = useState<string | null>(null);

    const handleRemove = async (userId: string) => {
        setRemoving(userId);
        try {
            await remove(userId);
        } finally {
            setRemoving(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg bg-card rounded-xl border border-border shadow-xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-semibold">{group.name}</h2>
                        <p className="text-sm text-muted-foreground">
                            {members.length} member{members.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <X size={20} weight="bold" />
                    </button>
                </div>

                <div className="p-6 max-h-96 overflow-y-auto">
                    {loading ? (
                        <div className="py-8 text-center">
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">Loading members...</p>
                        </div>
                    ) : members.length === 0 ? (
                        <div className="py-8 text-center">
                            <Users size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-2" />
                            <p className="text-sm text-muted-foreground">No members in this group</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {members.map((member) => (
                                <div
                                    key={member.userId}
                                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 group"
                                >
                                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                                        {member.avatarUrl ? (
                                            <img
                                                src={member.avatarUrl}
                                                alt={member.displayName}
                                                className="w-full h-full rounded-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                {member.displayName.slice(0, 2).toUpperCase()}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{member.displayName}</p>
                                        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => handleRemove(member.userId)}
                                        disabled={removing === member.userId}
                                        className="p-1.5 rounded-md text-muted-foreground hover:text-red-500
                                            hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all
                                            disabled:opacity-50"
                                        title="Remove from group"
                                    >
                                        <Trash size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex justify-end px-6 py-4 border-t border-border">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-md text-sm font-medium
                            bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

export function GroupsSection() {
    const { groups, loading, refresh, create, update, remove } = useGroups();
    const [editingGroup, setEditingGroup] = useState<SerializedGroupInfo | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [viewingMembersGroup, setViewingMembersGroup] = useState<SerializedGroupInfo | null>(null);

    // Fetch on mount
    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleCreate = async (name: string, description: string) => {
        await create(name, description);
    };

    const handleUpdate = async (name: string, description: string) => {
        if (editingGroup) {
            await update(editingGroup.id, { name, description });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <UsersThree size={24} weight="duotone" className="text-primary" />
                        <h1 className="text-2xl font-bold">Groups</h1>
                    </div>
                    <p className="text-muted-foreground">
                        Create and manage groups to organize members and share content.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
                        bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    <Plus size={16} />
                    Create Group
                </button>
            </div>

            {/* Groups list */}
            {loading ? (
                <div className="py-12 text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading groups...</p>
                </div>
            ) : groups.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-border rounded-lg">
                    <UsersThree size={48} weight="duotone" className="mx-auto text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No groups yet</h3>
                    <p className="text-muted-foreground mb-4">
                        Create a group to organize members and share content with them.
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowCreateModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
                            bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={16} />
                        Create your first group
                    </button>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {groups.map((group) => (
                        <GroupCard
                            key={group.id}
                            group={group}
                            onEdit={setEditingGroup}
                            onDelete={remove}
                            onViewMembers={setViewingMembersGroup}
                        />
                    ))}
                </div>
            )}

            {/* Create modal */}
            {showCreateModal && (
                <GroupFormModal onSave={handleCreate} onClose={() => setShowCreateModal(false)} />
            )}

            {/* Edit modal */}
            {editingGroup && (
                <GroupFormModal
                    group={editingGroup}
                    onSave={handleUpdate}
                    onClose={() => setEditingGroup(null)}
                />
            )}

            {/* Members modal */}
            {viewingMembersGroup && (
                <GroupMembersModal
                    group={viewingMembersGroup}
                    onClose={() => setViewingMembersGroup(null)}
                />
            )}
        </div>
    );
}

