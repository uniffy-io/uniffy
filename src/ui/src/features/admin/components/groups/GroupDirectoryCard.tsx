import { useState } from "react";
import { LockSimple, Pencil, Trash, TreeStructure, Users, UsersThree } from "@phosphor-icons/react";
import { GroupKind } from "@uniffy/proto/common/v1/common_pb";
import { cn } from "@/shared/utils/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SerializedGroupInfo } from "@/features/admin/store/adminSlice";
import { SubjectAvatarById } from "@/components/subject/SubjectAvatar";
import { useSubjectResolver } from "@/components/subject";

interface GroupDirectoryCardProps {
  group: SerializedGroupInfo;
  parentName?: string;
  onEdit: (group: SerializedGroupInfo) => void;
  onDelete: (groupId: string) => void | Promise<void>;
  onViewMembers: (group: SerializedGroupInfo) => void;
  className?: string;
}

export function GroupDirectoryCard({
  group,
  parentName,
  onEdit,
  onDelete,
  onViewMembers,
  className,
}: GroupDirectoryCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isTeam = group.kind === GroupKind.TEAM;
  const { subjects: leadSubjects } = useSubjectResolver(
    isTeam && group.leadUserId ? [group.leadUserId] : [],
  );
  const leadSubject = leadSubjects[0];

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
    <div
      className={cn(
        "p-4 rounded-xl bg-surface shadow-edge transition-shadow duration-150 hover:shadow-edge-strong",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "p-2 rounded-lg flex-shrink-0",
            isTeam ? "bg-primary/10" : "bg-violet-500/10",
          )}
        >
          {isTeam ? (
            <TreeStructure size={20} weight="duotone" className="text-primary" />
          ) : (
            <UsersThree
              size={20}
              weight="duotone"
              className="text-violet-600 dark:text-violet-400"
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-medium truncate">{group.name}</h3>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full shrink-0",
                isTeam
                  ? "bg-primary/10 text-primary"
                  : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
              )}
            >
              {isTeam ? "Team" : "Group"}
            </span>
            {group.isPrivate && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0 bg-muted text-muted-foreground">
                <LockSimple size={10} weight="bold" />
                Private
              </span>
            )}
          </div>
          {group.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{group.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users size={14} />
              {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
            </span>
            {isTeam && group.leadUserId && (
              <span className="flex items-center gap-1.5">
                <SubjectAvatarById
                  userId={group.leadUserId}
                  displayName={leadSubject?.name}
                  size="xs"
                />
                Lead: {leadSubject?.name ?? "..."}
              </span>
            )}
            {isTeam && parentName && <span>In: {parentName}</span>}
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
            title={isTeam ? "Edit team" : "Edit group"}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
            className="p-2 rounded-md text-muted-foreground hover-destructive transition-colors disabled:opacity-50"
            title={isTeam ? "Delete team" : "Delete group"}
          >
            <Trash size={16} />
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteConfirm}
        title={isTeam ? "Delete Team" : "Delete Group"}
        message={
          isTeam
            ? `Are you sure you want to delete "${group.name}"? Members keep their accounts; child teams detach.`
            : `Are you sure you want to delete "${group.name}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
