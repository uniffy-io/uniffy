import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowsClockwise,
  ArrowUUpLeft,
  CaretRight,
  CheckSquare,
  List,
  Square,
  SquaresFour,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { FilesLayout } from "@/features/files/components/FilesLayout";
import { FilesSidebar } from "@/features/files/components/sidebar/FilesSidebar";
import { FileCard } from "@/features/files/components/list/FileCard";
import { FolderCard } from "@/features/files/components/list/FolderCard";
import { IconSizeSlider } from "@/features/files/components/list/IconSizeSlider";
import {
  ICON_SIZE_CONFIG,
  SORT_OPTIONS,
  SORT_ORDER_OPTIONS,
  type SortByValue,
  type SortOrderValue,
} from "@/features/files/components/list/constants";
import { toggleSidebar, deleteFile, restoreFile } from "@/features/files/store/filesSlice";
import { deleteFolder, fetchFilesTree } from "@/features/files/store/filesTreeSlice";
import {
  fetchTrash,
  clearTrash,
  removeTrashFile,
  removeTrashFolder,
  setTrashFolderId,
} from "@/features/files/store/trashSlice";
import { filesApi } from "@/features/files/api/filesApi";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import type { SerializedFolder, SerializedTreeNode } from "@/features/files/store/filesTreeThunks";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

function folderToTreeNode(
  folder: SerializedFolder,
  childCount: number,
  sizeBytes: number,
): SerializedTreeNode {
  return {
    id: folder.id,
    name: folder.name,
    isFolder: true,
    parentId: folder.parentId,
    accessMode: folder.accessMode,
    childCount,
    sizeBytes,
  };
}

type SortValue = SortByValue;
type OrderValue = SortOrderValue;

function sortFiles(
  files: SerializedFile[],
  sortBy: SortValue,
  order: OrderValue,
): SerializedFile[] {
  const dir = order === "asc" ? 1 : -1;
  const copy = [...files];
  copy.sort((a, b) => {
    switch (sortBy) {
      case "filename":
        return a.filename.localeCompare(b.filename) * dir;
      case "size_bytes":
        return (a.sizeBytes - b.sizeBytes) * dir;
      case "created_at":
        return ((a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)) * dir;
      case "updated_at":
      default:
        return ((a.updatedAt?.seconds ?? 0) - (b.updatedAt?.seconds ?? 0)) * dir;
    }
  });
  return copy;
}

function sortFolders(
  folders: SerializedTreeNode[],
  sortBy: SortValue,
  order: OrderValue,
): SerializedTreeNode[] {
  const dir = order === "asc" ? 1 : -1;
  const copy = [...folders];
  copy.sort((a, b) => {
    if (sortBy === "size_bytes") {
      return ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)) * dir;
    }
    return a.name.localeCompare(b.name) * dir;
  });
  return copy;
}

function TrashView() {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const trash = useAppSelector((state) => state.trash);

  const currentFolderId = trash.currentFolderId;
  const currentFolder = currentFolderId
    ? trash.folders.find((f) => f.id === currentFolderId)
    : undefined;

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [iconSize, setIconSize] = useState<0 | 1 | 2 | 3>(1);
  const [sortBy, setSortBy] = useState<SortValue>("updated_at");
  const [sortOrder, setSortOrder] = useState<OrderValue>("desc");

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());

  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<
    | { kind: "file"; id: string; name: string }
    | { kind: "folder"; id: string; name: string }
    | { kind: "bulk"; fileIds: string[]; folderIds: string[] }
    | { kind: "empty" }
    | null
  >(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  useEffect(() => {
    const urlFolder = searchParams.get("folder");
    if ((urlFolder ?? null) !== currentFolderId) {
      dispatch(setTrashFolderId(urlFolder ?? null));
    }
  }, [searchParams, currentFolderId, dispatch]);

  useEffect(() => {
    if (organizationId) {
      dispatch(fetchTrash());
    }
  }, [organizationId, dispatch]);

  const { visibleFolders, visibleFiles } = useMemo(() => {
    const folderMap = new Map(trash.folders.map((f) => [f.id, f] as const));

    // At root: surface only top-level trashed items (skip children of trashed folders so they aren't listed twice).
    const foldersHere: SerializedFolder[] = trash.folders.filter((f) => {
      if (currentFolderId) {
        return f.parentId === currentFolderId;
      }
      return !f.parentId || !folderMap.has(f.parentId);
    });
    const filesHere: SerializedFile[] = trash.files.filter((f) => {
      if (currentFolderId) {
        return f.folderId === currentFolderId;
      }
      return !f.folderId || !folderMap.has(f.folderId);
    });

    const folderNodes: SerializedTreeNode[] = foldersHere.map((f) => {
      const childFolderCount = trash.folders.filter((x) => x.parentId === f.id).length;
      const childFileCount = trash.files.filter((x) => x.folderId === f.id).length;
      const size = trash.files
        .filter((x) => x.folderId === f.id)
        .reduce((acc, x) => acc + x.sizeBytes, 0);
      return folderToTreeNode(f, childFolderCount + childFileCount, size);
    });

    return {
      visibleFolders: sortFolders(folderNodes, sortBy, sortOrder),
      visibleFiles: sortFiles(filesHere, sortBy, sortOrder),
    };
  }, [trash.files, trash.folders, currentFolderId, sortBy, sortOrder]);

  // Build breadcrumbs from currentFolder up via parentId, stopping at the first non-trashed ancestor.
  const breadcrumbs = useMemo(() => {
    const crumbs: Array<{ id: string; name: string }> = [];
    let folder = currentFolder;
    while (folder) {
      crumbs.unshift({ id: folder.id, name: folder.name });
      folder = folder.parentId ? trash.folders.find((f) => f.id === folder!.parentId) : undefined;
    }
    return crumbs;
  }, [currentFolder, trash.folders]);

  // Only direct trash drops can be restored individually; descendants restore through their ancestor.
  const isDirectTrashDrop = useCallback(
    (parentId?: string) => !parentId || !trash.folders.some((f) => f.id === parentId),
    [trash.folders],
  );

  const totalSelected = selectedFileIds.size + selectedFolderIds.size;
  const totalVisible = visibleFolders.length + visibleFiles.length;

  const toggleSelectAll = useCallback(() => {
    if (totalSelected === totalVisible && totalVisible > 0) {
      setSelectedFileIds(new Set());
      setSelectedFolderIds(new Set());
    } else {
      setSelectedFileIds(new Set(visibleFiles.map((f) => f.id)));
      setSelectedFolderIds(new Set(visibleFolders.map((f) => f.id)));
    }
  }, [totalSelected, totalVisible, visibleFiles, visibleFolders]);

  const handleToggleFileCheck = useCallback((id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleFolderCheck = useCallback((id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
  }, []);

  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      if (folderId) {
        setSearchParams({ folder: folderId });
      } else {
        setSearchParams({});
      }
      clearSelection();
    },
    [setSearchParams, clearSelection],
  );

  const restoreOne = useCallback(
    async (kind: "file" | "folder", id: string) => {
      if (!organizationId) return;
      setRestoring((prev) => new Set(prev).add(id));
      try {
        if (kind === "file") {
          await dispatch(restoreFile(id)).unwrap();
          dispatch(removeTrashFile(id));
        } else {
          await filesApi.restoreFolder({ folderId: id, organizationId });
          dispatch(removeTrashFolder(id));
        }
        dispatch(fetchFilesTree({ includeFiles: false }));
      } finally {
        setRestoring((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
    [dispatch, organizationId],
  );

  const handleRestoreFile = useCallback((id: string) => restoreOne("file", id), [restoreOne]);
  const handleRestoreFolder = useCallback((id: string) => restoreOne("folder", id), [restoreOne]);

  const handleBulkRestore = useCallback(async () => {
    if (!organizationId) return;
    const folderIds = [...selectedFolderIds].filter((id) => {
      const f = trash.folders.find((x) => x.id === id);
      return f && isDirectTrashDrop(f.parentId);
    });
    const fileIds = [...selectedFileIds].filter((id) => {
      const f = trash.files.find((x) => x.id === id);
      return f && (!f.folderId || isDirectTrashDrop(f.folderId));
    });
    for (const id of folderIds) {
      await filesApi.restoreFolder({ folderId: id, organizationId });
      dispatch(removeTrashFolder(id));
    }
    for (const id of fileIds) {
      await dispatch(restoreFile(id)).unwrap();
      dispatch(removeTrashFile(id));
    }
    dispatch(fetchFilesTree({ includeFiles: false }));
    clearSelection();
  }, [
    organizationId,
    selectedFolderIds,
    selectedFileIds,
    trash.folders,
    trash.files,
    isDirectTrashDrop,
    dispatch,
    clearSelection,
  ]);

  const confirmPermanentDelete = useCallback(async () => {
    if (!pendingPermanentDelete || !organizationId) return;
    setDeleteLoading(true);
    try {
      if (pendingPermanentDelete.kind === "empty") {
        dispatch(clearTrash());
        try {
          await filesApi.emptyTrash({ organizationId });
        } catch (error) {
          dispatch(fetchTrash());
          throw error;
        }
        dispatch(fetchFilesTree({ includeFiles: false }));
      } else if (pendingPermanentDelete.kind === "file") {
        await dispatch(deleteFile({ fileId: pendingPermanentDelete.id, permanent: true })).unwrap();
        dispatch(removeTrashFile(pendingPermanentDelete.id));
      } else if (pendingPermanentDelete.kind === "folder") {
        await dispatch(
          deleteFolder({
            folderId: pendingPermanentDelete.id,
            recursive: true,
            permanent: true,
          }),
        ).unwrap();
        dispatch(removeTrashFolder(pendingPermanentDelete.id));
      } else {
        for (const id of pendingPermanentDelete.folderIds) {
          await dispatch(deleteFolder({ folderId: id, recursive: true, permanent: true })).unwrap();
          dispatch(removeTrashFolder(id));
        }
        for (const id of pendingPermanentDelete.fileIds) {
          await dispatch(deleteFile({ fileId: id, permanent: true })).unwrap();
          dispatch(removeTrashFile(id));
        }
      }
      clearSelection();
      setPendingPermanentDelete(null);
    } finally {
      setDeleteLoading(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [pendingPermanentDelete, organizationId, dispatch, clearSelection]);

  const requestDeleteFile = useCallback(
    (id: string) => {
      const file = trash.files.find((f) => f.id === id);
      setPendingPermanentDelete({ kind: "file", id, name: file?.filename ?? "this file" });
    },
    [trash.files],
  );

  const requestDeleteFolder = useCallback(
    (id: string) => {
      const folder = trash.folders.find((f) => f.id === id);
      setPendingPermanentDelete({ kind: "folder", id, name: folder?.name ?? "this folder" });
    },
    [trash.folders],
  );

  const requestBulkDelete = useCallback(() => {
    if (totalSelected === 0) return;
    setPendingPermanentDelete({
      kind: "bulk",
      fileIds: [...selectedFileIds],
      folderIds: [...selectedFolderIds],
    });
  }, [totalSelected, selectedFileIds, selectedFolderIds]);

  const requestEmptyTrash = useCallback(() => {
    setPendingPermanentDelete({ kind: "empty" });
  }, []);

  // No-ops for props the trash view doesn't surface but FileCard requires.
  const noop = useCallback(() => {}, []);
  const noopWithName = useCallback(() => {}, []);

  const iconConfig = ICON_SIZE_CONFIG[iconSize];

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className={cn("flex-shrink-0 border-b border-border", isSelectMode && "bg-primary/5")}>
        <div className="flex items-center gap-2 px-3 md:px-4 py-2 flex-wrap">
          {/* Title + count (hidden in select mode so the select state leads) */}
          {!isSelectMode && (
            <div className="flex items-center gap-2 mr-2">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <Trash size={16} weight="duotone" className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-none">Trash</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {trash.files.length + trash.folders.length} item
                  {trash.files.length + trash.folders.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          )}

          {/* Select button (left side, matches All Files toolbar) */}
          {!isSelectMode && totalVisible > 0 && (
            <button
              onClick={() => {
                setIsSelectMode(true);
                clearSelection();
              }}
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="Select files"
            >
              <CheckSquare size={16} />
              <span className="hidden sm:inline text-sm">Select</span>
            </button>
          )}

          {/* Select-mode header (select-all + count + exit) */}
          {isSelectMode && (
            <>
              <button
                onClick={toggleSelectAll}
                className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                title={
                  totalSelected === totalVisible && totalVisible > 0
                    ? "Clear selection"
                    : "Select all"
                }
              >
                {totalSelected === totalVisible && totalVisible > 0 ? (
                  <CheckSquare size={20} weight="fill" className="text-primary" />
                ) : totalSelected > 0 ? (
                  <CheckSquare size={20} weight="duotone" className="text-primary" />
                ) : (
                  <Square size={20} weight="regular" className="text-muted-foreground" />
                )}
              </button>
              <span className="text-sm font-medium truncate">
                {totalSelected > 0 ? `${totalSelected} selected` : "Select items"}
              </span>
              <button
                onClick={() => {
                  setIsSelectMode(false);
                  clearSelection();
                }}
                className="p-1 rounded-md hover:bg-muted transition-colors shrink-0"
                title="Exit select mode"
              >
                <X size={18} className="text-muted-foreground" />
              </button>
            </>
          )}

          <div className="flex-1" />

          {/* Bulk actions appear inline when in select mode */}
          {isSelectMode && totalSelected > 0 && (
            <>
              <button
                onClick={handleBulkRestore}
                className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-primary hover:bg-primary/10 transition-colors"
                title="Restore selected"
              >
                <ArrowUUpLeft size={16} weight="bold" />
                <span className="hidden md:inline">Restore</span>
              </button>
              <button
                onClick={requestBulkDelete}
                className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-red-600 dark:text-red-400 hover:bg-red-600/10 dark:hover:bg-red-400/10 transition-colors"
                title="Delete permanently"
              >
                <Trash size={16} />
                <span className="hidden md:inline">Delete Permanently</span>
              </button>
            </>
          )}

          {/* Sort (hidden in select mode to keep toolbar tidy, matches All Files) */}
          {!isSelectMode && (
            <>
              <Select
                value={sortBy}
                onChange={(v) => setSortBy(v as SortValue)}
                options={SORT_OPTIONS as unknown as { value: string; label: string }[]}
                size="sm"
              />
              <Select
                value={sortOrder}
                onChange={(v) => setSortOrder(v as OrderValue)}
                options={
                  SORT_ORDER_OPTIONS as unknown as {
                    value: string;
                    label: string;
                  }[]
                }
                size="sm"
              />
            </>
          )}

          {/* View mode */}
          <div className="flex items-center gap-0.5 ml-1">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                viewMode === "grid"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:bg-muted",
              )}
              title="Grid view"
            >
              <SquaresFour size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                viewMode === "list"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:bg-muted",
              )}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>

          {/* Icon size slider (grid view only, not in select mode) */}
          {viewMode === "grid" && !isSelectMode && (
            <IconSizeSlider value={iconSize} onChange={(v) => setIconSize(v as 0 | 1 | 2 | 3)} />
          )}

          {/* Empty trash (hidden in select mode to avoid clutter) */}
          {!isSelectMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={requestEmptyTrash}
              disabled={trash.files.length + trash.folders.length === 0}
            >
              <Trash size={14} />
              Empty Trash
            </Button>
          )}
        </div>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 px-3 md:px-4 pb-2 text-xs text-muted-foreground">
          <button
            onClick={() => navigateToFolder(null)}
            className={cn(
              "px-1 py-0.5 rounded hover:text-foreground",
              breadcrumbs.length === 0 && "text-foreground font-medium",
            )}
          >
            Trash
          </button>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                <CaretRight size={12} weight="bold" className="shrink-0 text-muted-foreground/50" />
                <button
                  onClick={() => !isLast && navigateToFolder(crumb.id)}
                  className={cn(
                    "truncate max-w-[200px] px-1 py-0.5 rounded",
                    isLast ? "text-foreground font-medium" : "hover:text-foreground",
                  )}
                  title={crumb.name}
                >
                  {crumb.name}
                </button>
              </span>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {trash.loading && totalVisible === 0 ? (
          <div className="flex items-center justify-center h-full">
            <ArrowsClockwise
              size={24}
              weight="bold"
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : totalVisible === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Trash size={64} weight="duotone" className="mb-4 opacity-50" />
            <p className="text-lg font-medium">
              {currentFolder ? `${currentFolder.name} is empty` : "Trash is empty"}
            </p>
            <p className="text-sm">
              {currentFolder
                ? "Nothing else was deleted inside this folder"
                : "Deleted files and folders will appear here"}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="p-4">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${iconConfig.cardMinWidth}px, 1fr))`,
                gap: `${iconConfig.gap}px`,
              }}
            >
              {visibleFolders.map((folder) => {
                const parentId = trash.folders.find((f) => f.id === folder.id)?.parentId;
                const canRestore = isDirectTrashDrop(parentId);
                return (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    onOpen={() => navigateToFolder(folder.id)}
                    onDelete={requestDeleteFolder}
                    onDownload={noop}
                    onShare={noopWithName}
                    onRename={noop}
                    onMove={noop}
                    viewMode="grid"
                    sizeConfig={iconConfig}
                    isSelectMode={isSelectMode}
                    isChecked={selectedFolderIds.has(folder.id)}
                    onToggleCheck={handleToggleFolderCheck}
                    canShare={false}
                    trashMode
                    canRestore={canRestore}
                    onRestore={canRestore ? handleRestoreFolder : undefined}
                  />
                );
              })}
              {visibleFiles.map((file) => {
                const canRestore = !file.folderId || isDirectTrashDrop(file.folderId);
                return (
                  <FileCard
                    key={file.id}
                    file={file}
                    isSelected={false}
                    onSelect={noop}
                    onOpen={noop}
                    onDelete={requestDeleteFile}
                    onDownload={noop}
                    onShare={noopWithName}
                    onRename={noop}
                    onUpdateTags={noop}
                    onMove={noop}
                    viewMode="grid"
                    sizeConfig={iconConfig}
                    isSelectMode={isSelectMode}
                    isChecked={selectedFileIds.has(file.id)}
                    onToggleCheck={handleToggleFileCheck}
                    canShare={false}
                    trashMode
                    canRestore={canRestore}
                    onRestore={canRestore ? handleRestoreFile : undefined}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-1">
            {visibleFolders.map((folder) => {
              const parentId = trash.folders.find((f) => f.id === folder.id)?.parentId;
              const canRestore = isDirectTrashDrop(parentId);
              return (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onOpen={() => navigateToFolder(folder.id)}
                  onDelete={requestDeleteFolder}
                  onDownload={noop}
                  onShare={noopWithName}
                  onRename={noop}
                  onMove={noop}
                  viewMode="list"
                  isSelectMode={isSelectMode}
                  isChecked={selectedFolderIds.has(folder.id)}
                  onToggleCheck={handleToggleFolderCheck}
                  canShare={false}
                  trashMode
                  canRestore={canRestore}
                  onRestore={canRestore ? handleRestoreFolder : undefined}
                />
              );
            })}
            {visibleFiles.map((file) => {
              const canRestore = !file.folderId || isDirectTrashDrop(file.folderId);
              return (
                <FileCard
                  key={file.id}
                  file={file}
                  isSelected={false}
                  onSelect={noop}
                  onOpen={noop}
                  onDelete={requestDeleteFile}
                  onDownload={noop}
                  onShare={noopWithName}
                  onRename={noop}
                  onUpdateTags={noop}
                  onMove={noop}
                  viewMode="list"
                  isSelectMode={isSelectMode}
                  isChecked={selectedFileIds.has(file.id)}
                  onToggleCheck={handleToggleFileCheck}
                  canShare={false}
                  trashMode
                  canRestore={canRestore}
                  onRestore={canRestore ? handleRestoreFile : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingPermanentDelete !== null}
        onClose={() => {
          if (!deleteLoading) setPendingPermanentDelete(null);
        }}
        onConfirm={confirmPermanentDelete}
        title={pendingPermanentDelete?.kind === "empty" ? "Empty Trash?" : "Delete Permanently?"}
        message={
          pendingPermanentDelete?.kind === "empty"
            ? `${trash.files.length + trash.folders.length} item${trash.files.length + trash.folders.length === 1 ? "" : "s"} will be permanently deleted. This cannot be undone.`
            : pendingPermanentDelete?.kind === "folder"
              ? `"${pendingPermanentDelete.name}" and everything inside it will be permanently deleted. This cannot be undone.`
              : pendingPermanentDelete?.kind === "bulk"
                ? `${pendingPermanentDelete.folderIds.length + pendingPermanentDelete.fileIds.length} selected item${pendingPermanentDelete.folderIds.length + pendingPermanentDelete.fileIds.length === 1 ? "" : "s"} will be permanently deleted. This cannot be undone.`
                : `"${pendingPermanentDelete?.name ?? "This file"}" will be permanently deleted. This cannot be undone.`
        }
        confirmLabel="Delete Permanently"
        variant="danger"
        loading={deleteLoading}
      />

      {/* Inline "restoring…" indicator for long operations */}
      {restoring.size > 0 && (
        <div className="fixed bottom-4 right-4 bg-card border border-border rounded-md shadow-lg px-3 py-2 text-sm flex items-center gap-2">
          <ArrowsClockwise size={14} weight="bold" className="animate-spin text-primary" />
          Restoring {restoring.size} item{restoring.size === 1 ? "" : "s"}...
        </div>
      )}
    </div>
  );
}

export function FilesTrashPage() {
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const isSidebarOpen = useAppSelector((state) => state.files.sidebarOpen);

  useDocumentTitle("Trash");

  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  return (
    <>
      <AppHeader />
      <FilesLayout
        sidebar={<FilesSidebar onToggleSidebar={handleToggleSidebar} />}
        content={<TrashView />}
        showSidebar={!isZenMode && isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
      />
    </>
  );
}

// Re-export so tree-shaking doesn't drop AccessMode used by folderToTreeNode types.
void AccessMode;
