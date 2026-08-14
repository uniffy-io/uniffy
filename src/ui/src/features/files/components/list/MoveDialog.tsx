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
import { moveItems } from "@/features/files/store/filesThunks";
import { initializeFilesData } from "@/features/files/store/filesSlice";
import { fetchFilesTree } from "@/features/files/store/filesTreeSlice";
import type { SerializedTreeNode } from "@/features/files/store/filesTreeThunks";

interface MoveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileIds: string[];
  folderIds: string[];
  currentAccessMode?: AccessMode;
  currentFolderId?: string | null;
  itemName?: string; // For single item display
}

type VisibilityOption = "personal" | "organization";

export function MoveDialog({
  isOpen,
  onClose,
  fileIds,
  folderIds,
  currentAccessMode,
  currentFolderId,
  itemName,
}: MoveDialogProps) {
  const dispatch = useAppDispatch();
  const tree = useAppSelector((state) => state.filesTree.tree);

  // Selected visibility scope
  const [selectedVisibility, setSelectedVisibility] = useState<VisibilityOption>(
    currentAccessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal",
  );

  // Selected folder ID (null = root)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId ?? null);

  // Expanded folders in the tree
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Loading state
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOrgConfirm, setShowOrgConfirm] = useState(false);

  const availableFolders = useMemo(() => {
    return selectedVisibility === "personal" ? tree.personal : tree.organization;
  }, [selectedVisibility, tree]);

  // Count of items being moved
  const itemCount = fileIds.length + folderIds.length;

  // Toggle folder expansion
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

  // Select a folder as destination
  const handleSelectFolder = useCallback(
    (folderId: string | null) => {
      // Don't allow selecting a folder that's being moved
      if (folderId && folderIds.includes(folderId)) return;
      setSelectedFolderId(folderId);
    },
    [folderIds],
  );

  const handleVisibilityChange = useCallback((visibility: VisibilityOption) => {
    setSelectedVisibility(visibility);
    setSelectedFolderId(null); // Reset folder selection when changing visibility
  }, []);

  // Check if move is valid
  const canMove = useMemo(() => {
    const newAccessMode =
      selectedVisibility === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

    const accessModeChanged = newAccessMode !== currentAccessMode;
    const folderChanged = selectedFolderId !== currentFolderId;

    return accessModeChanged || folderChanged;
  }, [selectedVisibility, selectedFolderId, currentAccessMode, currentFolderId]);

  // Perform the actual move
  const performMove = useCallback(async () => {
    setIsMoving(true);
    setError(null);

    try {
      const targetAccessMode =
        selectedVisibility === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

      await dispatch(
        moveItems({
          fileIds,
          folderIds,
          targetFolderId: selectedFolderId,
          targetAccessMode,
        }),
      ).unwrap();

      dispatch(initializeFilesData({ forceRefresh: true }));
      dispatch(fetchFilesTree({ includeFiles: false }));

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move items");
    } finally {
      setIsMoving(false);
      setShowOrgConfirm(false);
    }
  }, [dispatch, fileIds, folderIds, selectedFolderId, selectedVisibility, onClose]);

  // Moving to ORG visibility is destructive enough to confirm.
  const handleMove = useCallback(async () => {
    const targetAccessMode =
      selectedVisibility === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

    if (
      targetAccessMode === AccessMode.OPEN_TO_ORG &&
      currentAccessMode !== AccessMode.OPEN_TO_ORG
    ) {
      setShowOrgConfirm(true);
      return;
    }

    await performMove();
  }, [selectedVisibility, currentAccessMode, performMove]);

  const renderFolderNode = useCallback(
    (node: SerializedTreeNode, depth = 0): React.ReactNode => {
      if (!node.isFolder) return null;

      const isExpanded = expandedFolders.has(node.id);
      const isSelected = selectedFolderId === node.id;
      const isDisabled = folderIds.includes(node.id); // Can't move to itself
      const hasChildren = node.children && node.children.filter((c) => c.isFolder).length > 0;

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
            <span className="text-sm truncate flex-1">{node.name}</span>
          </div>

          {isExpanded && hasChildren && (
            <div>
              {node
                .children!.filter((c) => c.isFolder)
                .map((child) => renderFolderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [expandedFolders, selectedFolderId, folderIds, handleSelectFolder, toggleFolder],
  );

  if (!isOpen) return null;

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
              <h2 className="text-lg font-semibold">
                Move {itemCount > 1 ? `${itemCount} items` : itemName || "Item"}
              </h2>
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
          message="Moving to Organization will make these items visible to all organization members. Any content referenced within (attached files, mentioned notes, inline media) will also become visible to the organization."
          confirmLabel="Move to Organization"
          cancelLabel="Cancel"
          variant="warning"
          loading={isMoving}
        />
      </div>
    </div>
  );
}
