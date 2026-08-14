/**
 * Note Move Dialog Component
 *
 * Dialog for moving notes/folders to a different access mode and/or parent folder.
 * Adapted from the files MoveDialog pattern.
 */

import { useState, useCallback, useMemo } from "react";
import {
  Folder,
  FolderOpen,
  LockSimple,
  Buildings,
  CaretRight,
  CaretDown,
  X,
  ArrowRight,
} from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/shared/utils/cn";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { moveNote, updateNote, initializeNotesData } from "@/features/notes/store/notesSlice";
import type { TreeNode, MoveTarget } from "@/features/notes/components/sidebar/types";

type VisibilityOption = "personal" | "organization";

interface NoteMoveDialogProps {
  target: MoveTarget;
  onClose: () => void;
}

export function NoteMoveDialog({ target, onClose }: NoteMoveDialogProps) {
  const dispatch = useAppDispatch();
  const tree = useAppSelector((state) => state.notesTree.tree);

  const [selectedVisibility, setSelectedVisibility] = useState<VisibilityOption>(
    target.currentAccessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal",
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(target.currentParentId);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOrgConfirm, setShowOrgConfirm] = useState(false);

  // Get only folders for the selected visibility
  const availableFolders = useMemo(() => {
    const nodes = selectedVisibility === "personal" ? tree.personal : tree.organization;
    function filterFolders(items: TreeNode[]): TreeNode[] {
      return items
        .filter((n) => n.type === "folder" && n.id !== target.noteId)
        .map((n) => ({
          ...n,
          children: n.children ? filterFolders(n.children) : undefined,
        }));
    }
    return filterFolders(nodes);
  }, [selectedVisibility, tree.personal, tree.organization, target.noteId]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleSelectFolder = useCallback(
    (folderId: string | null) => {
      if (folderId === target.noteId) return;
      setSelectedFolderId(folderId);
    },
    [target.noteId],
  );

  const handleVisibilityChange = useCallback((visibility: VisibilityOption) => {
    setSelectedVisibility(visibility);
    setSelectedFolderId(null);
  }, []);

  const canMove = useMemo(() => {
    const newAccessMode =
      selectedVisibility === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

    const accessModeChanged = newAccessMode !== target.currentAccessMode;
    const folderChanged = selectedFolderId !== target.currentParentId;

    return accessModeChanged || folderChanged;
  }, [selectedVisibility, selectedFolderId, target.currentAccessMode, target.currentParentId]);

  const performMove = useCallback(async () => {
    setIsMoving(true);
    setError(null);

    try {
      const targetAccessMode =
        selectedVisibility === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

      // Change access mode if needed
      if (targetAccessMode !== target.currentAccessMode) {
        await dispatch(
          moveNote({
            noteId: target.noteId,
            targetAccessMode,
          }),
        ).unwrap();
      }

      // Change parent folder if needed
      const newParentId = selectedFolderId ?? "";
      const currentParentId = target.currentParentId ?? "";
      if (newParentId !== currentParentId) {
        await dispatch(
          updateNote({
            noteId: target.noteId,
            parentId: newParentId,
          }),
        ).unwrap();
      }

      dispatch(initializeNotesData({ forceRefresh: true }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move note");
    } finally {
      setIsMoving(false);
      setShowOrgConfirm(false);
    }
  }, [dispatch, selectedVisibility, selectedFolderId, target, onClose]);

  const handleMove = useCallback(async () => {
    const targetAccessMode =
      selectedVisibility === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

    if (
      targetAccessMode === AccessMode.OPEN_TO_ORG &&
      target.currentAccessMode !== AccessMode.OPEN_TO_ORG
    ) {
      setShowOrgConfirm(true);
      return;
    }

    await performMove();
  }, [selectedVisibility, target.currentAccessMode, performMove]);

  const renderFolderNode = useMemo(() => {
    function renderNode(node: TreeNode, depth = 0): React.ReactNode {
      if (node.type !== "folder") return null;

      const isExpanded = expandedFolders.has(node.id);
      const isSelected = selectedFolderId === node.id;
      const isDisabled = node.id === target.noteId;
      const folderChildren = node.children?.filter((c) => c.type === "folder") ?? [];
      const hasChildren = folderChildren.length > 0;

      return (
        <div key={node.id}>
          <div
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
              isSelected && "bg-primary/10 ring-1 ring-primary",
              !isSelected && !isDisabled && "hover:bg-muted",
              isDisabled && "opacity-50 cursor-not-allowed",
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => !isDisabled && handleSelectFolder(node.id)}
          >
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(node.id);
                }}
                className="p-0.5"
              >
                {isExpanded ? (
                  <CaretDown size={12} weight="bold" className="text-muted-foreground" />
                ) : (
                  <CaretRight size={12} weight="bold" className="text-muted-foreground" />
                )}
              </button>
            ) : (
              <span className="w-4" />
            )}
            {isExpanded ? (
              <FolderOpen size={16} weight="duotone" className="text-muted-foreground" />
            ) : (
              <Folder size={16} weight="duotone" className="text-muted-foreground" />
            )}
            <span className="text-sm truncate flex-1">{node.title}</span>
          </div>

          {isExpanded && hasChildren && (
            <div>{folderChildren.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    }
    return renderNode;
  }, [expandedFolders, selectedFolderId, target.noteId, handleSelectFolder, toggleFolder]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-background w-full max-w-md rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <ArrowRight size={20} weight="duotone" className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Move {target.noteTitle}</h2>
              <p className="text-xs text-muted-foreground">Select destination</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X size={18} className="text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Visibility Selection */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Move to</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleVisibilityChange("personal")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all",
                  selectedVisibility === "personal"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30",
                )}
              >
                <LockSimple
                  size={20}
                  weight={selectedVisibility === "personal" ? "fill" : "duotone"}
                  className={
                    selectedVisibility === "personal" ? "text-primary" : "text-muted-foreground"
                  }
                />
                <span
                  className={cn(
                    "font-medium",
                    selectedVisibility === "personal" ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  Personal
                </span>
              </button>
              <button
                onClick={() => handleVisibilityChange("organization")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all",
                  selectedVisibility === "organization"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30",
                )}
              >
                <Buildings
                  size={20}
                  weight={selectedVisibility === "organization" ? "fill" : "duotone"}
                  className={
                    selectedVisibility === "organization" ? "text-primary" : "text-muted-foreground"
                  }
                />
                <span
                  className={cn(
                    "font-medium",
                    selectedVisibility === "organization"
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  Organization
                </span>
              </button>
            </div>
          </div>

          {/* Folder Selection */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Folder</label>
            <div className="border border-border rounded-lg max-h-64 overflow-y-auto">
              {/* Root option */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-border",
                  selectedFolderId === null && "bg-primary/10",
                )}
                onClick={() => handleSelectFolder(null)}
              >
                <Folder size={16} weight="duotone" className="text-muted-foreground" />
                <span className="text-sm font-medium">Root (No folder)</span>
              </div>

              {/* Folder tree */}
              <div className="py-1">
                {availableFolders.length > 0 ? (
                  availableFolders.map((node) => renderFolderNode(node))
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    No folders in{" "}
                    {selectedVisibility === "personal" ? "Personal Space" : "Organization"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
          <Button variant="outline" size="md" onClick={onClose} disabled={isMoving}>
            Cancel
          </Button>
          <Button variant="default" size="md" onClick={handleMove} disabled={isMoving || !canMove}>
            {isMoving ? "Moving..." : "Move"}
          </Button>
        </div>

        {/* Organization Move Confirmation */}
        <ConfirmDialog
          isOpen={showOrgConfirm}
          onClose={() => setShowOrgConfirm(false)}
          onConfirm={performMove}
          title="Move to Organization"
          message="Moving this note to Organization will make it visible to all organization members. Any content referenced within (attached files, mentioned notes, inline media) will also become visible to the organization."
          confirmLabel="Move to Organization"
          cancelLabel="Cancel"
          variant="warning"
          loading={isMoving}
        />
      </div>
    </div>
  );
}
