import { useCallback, useMemo, useState } from "react";
import {
  File,
  Folder,
  FolderPlus,
  FolderOpen,
  List,
  SquaresFour,
  CloudArrowUp,
  BookmarkSimple,
  CheckSquare,
  Square,
  X,
  FileArrowDown,
  Trash,
  Funnel,
  SidebarSimple,
  ShareNetwork,
  ArrowRight,
  CaretRight,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, type SelectOption } from "@/components/ui/select";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { renderIcon } from "@/components/icon-picker";
import { useNavigate } from "react-router-dom";
import { useSavedFilters } from "@/features/files/hooks/useSavedFilters";
import { useApplyFilter } from "@/features/files/hooks/useApplyFilter";
import {
  setCurrentFile,
  setViewMode,
  setSortBy,
  setSortOrder,
  setIconSize,
  deleteFile,
  setFolderId,
  setSelectMode,
  toggleFileSelection,
  toggleFolderSelection,
  selectFileRange,
  selectFolderRange,
  selectAll,
  clearSelection,
  exitSelectMode,
  clearActiveFilter,
  toggleDetailsPanel,
} from "@/features/files/store/filesSlice";
import { openViewer } from "@/features/files/store/viewerSlice";
import { updateFile } from "@/features/files/store/filesThunks";
import { IconSizeSlider } from "@/features/files/components/list/IconSizeSlider";
import {
  setSelectedFolder,
  deleteFolder,
  updateFolder,
  fetchFilesTree,
} from "@/features/files/store/filesTreeSlice";
import { selectSubfoldersForCurrentFolder } from "@/features/files/store/selectors";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import type { SerializedTreeNode, SerializedFolder } from "@/features/files/store/filesTreeThunks";
import { useAccessPolicyDialog } from "@/features/permissions";
import { addBookmarksSafely, useBookmarkStatuses } from "@/features/bookmarks";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { ContentType, AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { bucketForContent, roleCanDelete, roleCanEdit } from "@/shared/utils/contentRoles";
import type { FileDownloadItem } from "@/features/files/utils/archiveDownload";
import {
  collectAllDownloadFiles,
  createFileInfoArray,
} from "@/features/files/utils/folderDownload";
import { FolderCard } from "@/features/files/components/list/FolderCard";
import { FileCard } from "@/features/files/components/list/FileCard";
import { MoveDialog } from "@/features/files/components/list/MoveDialog";
import {
  ICON_SIZE_CONFIG,
  SORT_OPTIONS,
  SORT_ORDER_OPTIONS,
  type SortByValue,
  type SortOrderValue,
} from "@/features/files/components/list/constants";
import { FilesListSkeleton } from "@/features/files/components/list/FilesListSkeleton";

function buildFolderBreadcrumb(
  folders: Record<string, SerializedFolder>,
  currentFolderId: string | null,
): Array<{ id: string; name: string }> {
  if (!currentFolderId || currentFolderId === "all") return [];

  const path: Array<{ id: string; name: string }> = [];
  let folderId: string | undefined = currentFolderId;

  while (folderId) {
    const folder: SerializedFolder | undefined = folders[folderId];
    if (!folder) break;
    path.unshift({ id: folder.id, name: folder.name });
    folderId = folder.parentId;
  }

  return path;
}

function findFolderNode(nodes: SerializedTreeNode[], folderId: string): SerializedTreeNode | null {
  for (const node of nodes) {
    if (node.id === folderId) return node;
    if (node.children) {
      const found = findFolderNode(node.children, folderId);
      if (found) return found;
    }
  }
  return null;
}

interface FilesListProps {
  files: SerializedFile[];
  allFiles?: SerializedFile[]; // All files in store (for folder download)
  loading?: boolean;
  onDownload?: (fileId: string) => void;
  onBulkDownload?: (items: FileDownloadItem[]) => Promise<void>;
  onUpload?: () => void;
  onUploadFolder?: () => void;
  onCreateFolder?: () => Promise<string | undefined> | string | undefined | void;
  onToggleSidebar?: () => void;
  folderTree?: {
    personal: SerializedTreeNode[];
    shared: SerializedTreeNode[];
    organization: SerializedTreeNode[];
  };
}

export function FilesList({
  files,
  allFiles,
  loading,
  onDownload,
  onBulkDownload,
  onUpload,
  onUploadFolder,
  onCreateFolder,
  onToggleSidebar,
  folderTree,
}: FilesListProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();
  const currentFileId = useAppSelector((state) => state.files.currentFileId);
  const filesMap = useAppSelector((state) => state.files.files);
  const viewMode = useAppSelector((state) => state.files.viewMode);
  const iconSize = useAppSelector((state) => state.files.iconSize);
  const sortBy = useAppSelector((state) => state.files.filters.sortBy);
  const sortOrder = useAppSelector((state) => state.files.filters.sortOrder);
  const viewScope = useAppSelector((state) => state.files.filters.viewScope);
  const userId = useAppSelector((state) => state.auth.user?.id);

  const currentFile = currentFileId ? filesMap[currentFileId] : null;

  // Active filter state
  const activeFilterId = useAppSelector((state) => state.files.activeFilter.id);

  // Details panel state
  const isDetailsPanelOpen = useAppSelector((state) => state.files.isDetailsPanelOpen);

  // Saved filters for dropdown
  const { filters: savedFilters } = useSavedFilters();
  const { applyFilter } = useApplyFilter();

  // Selection mode state
  const isSelectMode = useAppSelector((state) => state.files.isSelectMode);
  const selectedFileIds = useAppSelector((state) => state.files.selectedFileIds);
  const selectedFolderIds = useAppSelector((state) => state.files.selectedFolderIds);
  const lastSelectedId = useAppSelector((state) => state.files.lastSelectedId);
  const lastSelectedType = useAppSelector((state) => state.files.lastSelectedType);

  const subfolders = useAppSelector(selectSubfoldersForCurrentFolder);

  // Folder breadcrumb
  const currentFolderId = useAppSelector((state) => state.files.filters.folderId);
  const folders = useAppSelector((state) => state.filesTree.folders);
  const breadcrumbItems = useMemo(
    () => buildFolderBreadcrumb(folders, currentFolderId),
    [folders, currentFolderId],
  );

  const handleBreadcrumbNavigate = useCallback(
    (folderId: string | null) => {
      dispatch(setSelectedFolder(folderId));
      dispatch(setFolderId(folderId));
      if (folderId) {
        navigate(`/files?folder=${folderId}`);
      } else {
        navigate("/files");
      }
    },
    [dispatch, navigate],
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Folder id that should open in rename mode immediately after creation.
  const [pendingRenameFolderId, setPendingRenameFolderId] = useState<string | null>(null);
  const handleAutoRenameResolved = useCallback(() => {
    setPendingRenameFolderId(null);
  }, []);

  const handleCreateFolderClick = useCallback(async () => {
    if (!onCreateFolder) return;
    const result = await onCreateFolder();
    if (result) setPendingRenameFolderId(result);
  }, [onCreateFolder]);

  // Bulk action loading state
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Move dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveFileIds, setMoveFileIds] = useState<string[]>([]);
  const [moveFolderIds, setMoveFolderIds] = useState<string[]>([]);
  const [moveItemName, setMoveItemName] = useState<string | undefined>();
  const [moveCurrentAccessMode, setMoveCurrentAccessMode] = useState<AccessMode | undefined>();
  const [moveCurrentFolderId, setMoveCurrentFolderId] = useState<string | null | undefined>();

  // Access policy dialog
  const { openFor } = useAccessPolicyDialog();

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Don't show context menu in "Shared With Me" view
      if (viewScope === "shared") {
        return;
      }
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [viewScope],
  );

  // Sort files
  const sortedFiles = useMemo(() => {
    const sorted = [...files].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "filename":
          comparison = a.filename.localeCompare(b.filename);
          break;
        case "size_bytes":
          comparison = a.sizeBytes - b.sizeBytes;
          break;
        case "created_at":
          comparison = (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
          break;
        case "updated_at":
        default:
          comparison = (a.updatedAt?.seconds ?? 0) - (b.updatedAt?.seconds ?? 0);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [files, sortBy, sortOrder]);

  // Filter out deleted files
  const activeFiles = useMemo(() => sortedFiles.filter((f) => !f.isDeleted), [sortedFiles]);

  // Filter files by view scope
  const scopedFiles = useMemo(() => {
    if (viewScope === "all" || !userId) {
      return activeFiles;
    }

    return activeFiles.filter((f) => {
      const bucket = bucketForContent({
        ownerId: f.ownerId,
        accessMode: f.accessMode,
        currentUserId: userId,
      });
      return bucket === viewScope;
    });
  }, [activeFiles, viewScope, userId]);

  // Filter subfolders by view scope
  const scopedSubfolders = useMemo(() => {
    if (viewScope === "all" || !userId) {
      return subfolders;
    }

    return subfolders.filter((f) => {
      if (viewScope === "organization") return f.accessMode === AccessMode.OPEN_TO_ORG;
      if (viewScope === "personal") return f.accessMode === AccessMode.OWNER_ONLY;
      return f.accessMode === AccessMode.EXPLICIT_MEMBERS;
    });
  }, [subfolders, viewScope, userId]);

  const visibleBookmarkUrns = useMemo(
    () => [
      ...scopedFiles.map((file) => `urn:uniffy:content:FILE:${file.id}`),
      ...scopedSubfolders.map((folder) => `urn:uniffy:content:FOLDER:${folder.id}`),
    ],
    [scopedFiles, scopedSubfolders],
  );
  useBookmarkStatuses(visibleBookmarkUrns);

  // Single click - just select the file (for details panel)
  const handleSelectFile = useCallback(
    (fileId: string) => {
      dispatch(setCurrentFile(fileId));
    },
    [dispatch],
  );

  // Double click - open the file viewer
  const handleOpenFile = useCallback(
    (fileId: string) => {
      dispatch(setCurrentFile(fileId));
      const playlist = scopedFiles.map((f) => f.id);
      dispatch(openViewer({ fileId, playlist }));
    },
    [dispatch, scopedFiles],
  );

  // Pending delete confirmation (single file, single folder, or bulk)
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "file"; id: string; name: string }
    | { kind: "folder"; id: string; name: string }
    | { kind: "bulk"; fileIds: string[]; folderIds: string[] }
    | null
  >(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const executeDeleteFile = useCallback(
    async (fileId: string) => {
      await dispatch(deleteFile({ fileId }));
      dispatch(fetchFilesTree({ includeFiles: false }));
    },
    [dispatch],
  );

  const handleDeleteFile = useCallback(
    (fileId: string) => {
      const file = filesMap[fileId];
      setPendingDelete({ kind: "file", id: fileId, name: file?.filename ?? "this file" });
    },
    [filesMap],
  );

  const handleDownload = useCallback(
    (fileId: string) => {
      onDownload?.(fileId);
    },
    [onDownload],
  );

  const handleShare = useCallback(
    (fileId: string, filename: string) => {
      openFor(ContentType.FILE, fileId, filename);
    },
    [openFor],
  );

  const handleRenameFile = useCallback(
    async (fileId: string, newName: string) => {
      await dispatch(updateFile({ fileId, filename: newName }));
    },
    [dispatch],
  );

  // Move file handler (single file from context menu)
  const handleMoveFile = useCallback(
    (fileId: string) => {
      const file = filesMap[fileId];
      if (file) {
        setMoveFileIds([fileId]);
        setMoveFolderIds([]);
        setMoveItemName(file.filename);
        setMoveCurrentAccessMode(file.accessMode as AccessMode);
        setMoveCurrentFolderId(file.folderId ?? null);
        setMoveDialogOpen(true);
      }
    },
    [filesMap],
  );

  // Move folder handler (single folder from context menu)
  const handleMoveFolder = useCallback(
    (folderId: string) => {
      const folder = folderTree
        ? findFolderNode(folderTree.personal, folderId) ||
          findFolderNode(folderTree.organization, folderId) ||
          findFolderNode(folderTree.shared, folderId)
        : null;

      if (folder) {
        setMoveFileIds([]);
        setMoveFolderIds([folderId]);
        setMoveItemName(folder.name);
        setMoveCurrentAccessMode(folder.accessMode as AccessMode);
        setMoveCurrentFolderId(folder.parentId ?? null);
        setMoveDialogOpen(true);
      }
    },
    [folderTree],
  );

  // Bulk move handler
  const handleBulkMove = useCallback(() => {
    setMoveFileIds([...selectedFileIds]);
    setMoveFolderIds([...selectedFolderIds]);
    setMoveItemName(undefined);
    setMoveCurrentAccessMode(undefined);
    setMoveCurrentFolderId(undefined);
    setMoveDialogOpen(true);
  }, [selectedFileIds, selectedFolderIds]);

  // Close move dialog
  const handleCloseMoveDialog = useCallback(() => {
    setMoveDialogOpen(false);
    setMoveFileIds([]);
    setMoveFolderIds([]);
    setMoveItemName(undefined);
    setMoveCurrentAccessMode(undefined);
    setMoveCurrentFolderId(undefined);
    // Clear selection after successful move
    dispatch(clearSelection());
  }, [dispatch]);

  const handleUpdateFileTags = useCallback(
    async (fileId: string, tagIds: string[]) => {
      await dispatch(updateFile({ fileId, tagIds }));
    },
    [dispatch],
  );

  const handleOpenFolder = useCallback(
    (folderId: string) => {
      dispatch(setSelectedFolder(folderId));
      dispatch(setFolderId(folderId));
      navigate(`/files?folder=${folderId}`);
    },
    [dispatch, navigate],
  );

  const handleSortOrderChange = useCallback(
    (value: SortOrderValue) => {
      dispatch(setSortOrder(value));
    },
    [dispatch],
  );

  // Filter dropdown options
  const filterOptions = useMemo((): SelectOption<string>[] => {
    const options: SelectOption<string>[] = [
      { value: "", label: "All Files", icon: <Funnel size={14} weight="regular" /> },
    ];
    savedFilters.forEach((filter) => {
      // Use custom icon if available, otherwise default Funnel
      let icon: React.ReactNode;
      if (filter.icon) {
        if (filter.icon.type === "emoji") {
          icon = <span className="text-sm leading-none">{filter.icon.value}</span>;
        } else {
          icon = renderIcon(filter.icon, undefined, 14);
        }
      } else {
        icon = (
          <Funnel
            size={14}
            weight={filter.isPreset ? "fill" : "duotone"}
            className="text-primary"
          />
        );
      }
      options.push({
        value: filter.id,
        label: filter.name,
        icon,
      });
    });
    return options;
  }, [savedFilters]);

  const handleFilterChange = useCallback(
    (filterId: string) => {
      if (!filterId) {
        // Clear filter (preserve current folder)
        dispatch(clearActiveFilter());
      } else {
        const filter = savedFilters.find((f) => f.id === filterId);
        if (filter) {
          applyFilter(filter);
        }
      }
    },
    [dispatch, savedFilters, applyFilter],
  );

  // File selection handlers
  const handleToggleFileCheck = useCallback(
    (fileId: string, shiftKey: boolean) => {
      // Shift+click: select range from last selected file to current
      if (shiftKey && lastSelectedId && lastSelectedType === "file" && lastSelectedId !== fileId) {
        const startIndex = scopedFiles.findIndex((f) => f.id === lastSelectedId);
        const endIndex = scopedFiles.findIndex((f) => f.id === fileId);

        if (startIndex !== -1 && endIndex !== -1) {
          const fromIndex = Math.min(startIndex, endIndex);
          const toIndex = Math.max(startIndex, endIndex);
          const rangeFileIds = scopedFiles.slice(fromIndex, toIndex + 1).map((f) => f.id);
          dispatch(selectFileRange({ fileIds: rangeFileIds, anchorId: fileId }));
          return;
        }
      }

      // Normal click: toggle single file
      dispatch(toggleFileSelection(fileId));
    },
    [dispatch, lastSelectedId, lastSelectedType, scopedFiles],
  );

  // Folder selection handlers
  const handleToggleFolderCheck = useCallback(
    (folderId: string, shiftKey: boolean) => {
      // Shift+click: select range from last selected folder to current
      if (
        shiftKey &&
        lastSelectedId &&
        lastSelectedType === "folder" &&
        lastSelectedId !== folderId
      ) {
        const startIndex = scopedSubfolders.findIndex((f) => f.id === lastSelectedId);
        const endIndex = scopedSubfolders.findIndex((f) => f.id === folderId);

        if (startIndex !== -1 && endIndex !== -1) {
          const fromIndex = Math.min(startIndex, endIndex);
          const toIndex = Math.max(startIndex, endIndex);
          const rangeFolderIds = scopedSubfolders.slice(fromIndex, toIndex + 1).map((f) => f.id);
          dispatch(selectFolderRange({ folderIds: rangeFolderIds, anchorId: folderId }));
          return;
        }
      }

      // Normal click: toggle single folder
      dispatch(toggleFolderSelection(folderId));
    },
    [dispatch, lastSelectedId, lastSelectedType, scopedSubfolders],
  );

  const handleSelectAll = useCallback(() => {
    const allFileIds = scopedFiles.map((f) => f.id);
    const allFolderIds = scopedSubfolders.map((f) => f.id);
    dispatch(selectAll({ fileIds: allFileIds, folderIds: allFolderIds }));
  }, [dispatch, scopedFiles, scopedSubfolders]);

  const handleClearSelection = useCallback(() => {
    dispatch(clearSelection());
  }, [dispatch]);

  const handleExitSelectMode = useCallback(() => {
    dispatch(exitSelectMode());
  }, [dispatch]);

  // Total selected count (files + folders)
  const totalSelectedCount = selectedFileIds.length + selectedFolderIds.length;

  // Bulk actions
  const executeBulkDelete = useCallback(
    async (fileIds: string[], folderIds: string[]) => {
      setBulkActionLoading(true);
      try {
        // Delete folders first
        for (const folderId of folderIds) {
          await dispatch(deleteFolder({ folderId, recursive: true }));
        }
        // Then delete files
        for (const fileId of fileIds) {
          await dispatch(deleteFile({ fileId }));
        }
        dispatch(clearSelection());
        dispatch(fetchFilesTree({ includeFiles: false }));
      } finally {
        setBulkActionLoading(false);
      }
    },
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
    [dispatch],
  );

  const handleBulkDelete = useCallback(() => {
    if (totalSelectedCount === 0) return;
    setPendingDelete({
      kind: "bulk",
      fileIds: [...selectedFileIds],
      folderIds: [...selectedFolderIds],
    });
  }, [selectedFileIds, selectedFolderIds, totalSelectedCount]);

  // Use allFiles so recursive folder downloads see content the current view filters out.
  const filesForDownload = allFiles || files;
  const allFilesInfo = useMemo(
    () =>
      createFileInfoArray(
        filesForDownload.reduce(
          (acc, f) => {
            acc[f.id] = { id: f.id, filename: f.filename, folderId: f.folderId };
            return acc;
          },
          {} as Record<string, { id: string; filename: string; folderId?: string }>,
        ),
      ),
    [filesForDownload],
  );

  const handleBulkDownload = useCallback(async () => {
    // Nothing selected
    if (selectedFileIds.length === 0 && selectedFolderIds.length === 0) return;

    // Use bulk download (archive) if available
    if (onBulkDownload) {
      setBulkActionLoading(true);
      try {
        let downloadItems: FileDownloadItem[];

        // If folders are selected and we have the tree, collect files recursively
        if (selectedFolderIds.length > 0 && folderTree) {
          const filesWithPaths = collectAllDownloadFiles(
            selectedFileIds,
            selectedFolderIds,
            folderTree,
            allFilesInfo,
          );
          downloadItems = filesWithPaths;
        } else {
          // Just selected files (no folders or no tree available)
          downloadItems = selectedFileIds.map((id) => ({ fileId: id }));
        }

        if (downloadItems.length > 0) {
          await onBulkDownload(downloadItems);
        }
      } finally {
        setBulkActionLoading(false);
      }
    } else if (onDownload) {
      // Fallback: download files individually (only selected files, not folder contents)
      selectedFileIds.forEach((fileId) => onDownload(fileId));
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [selectedFileIds, selectedFolderIds, onBulkDownload, onDownload, folderTree, allFilesInfo]);

  // Folder action handlers (must be after allFilesInfo is defined)
  const executeDeleteFolder = useCallback(
    async (folderId: string) => {
      await dispatch(deleteFolder({ folderId, recursive: true }));
      dispatch(fetchFilesTree({ includeFiles: false }));
    },
    [dispatch],
  );

  const handleDeleteFolderAction = useCallback(
    (folderId: string) => {
      const folder = folders[folderId];
      setPendingDelete({ kind: "folder", id: folderId, name: folder?.name ?? "this folder" });
    },
    [folders],
  );

  const handleDownloadFolder = useCallback(
    async (folderId: string) => {
      if (!onBulkDownload || !folderTree) return;

      // Collect all files in this folder and scopedSubfolders
      const filesWithPaths = collectAllDownloadFiles([], [folderId], folderTree, allFilesInfo);

      if (filesWithPaths.length > 0) {
        await onBulkDownload(filesWithPaths);
      }
    },
    [onBulkDownload, folderTree, allFilesInfo],
  );

  const handleShareFolder = useCallback(
    (folderId: string, folderName: string) => {
      openFor(ContentType.FOLDER, folderId, folderName);
    },
    [openFor],
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      await dispatch(updateFolder({ folderId, name: newName }));
    },
    [dispatch],
  );

  const handleBulkBookmark = useCallback(async () => {
    if (selectedFileIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      const urns = selectedFileIds.map((fileId) => `urn:uniffy:content:FILE:${fileId}`);
      await dispatch(addBookmarksSafely(urns));
    } finally {
      setBulkActionLoading(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [dispatch, selectedFileIds]);

  const canDeleteFile = useCallback(
    (file: SerializedFile) => file.ownerId === userId || roleCanDelete(file.userRole),
    [userId],
  );

  const canEditFile = useCallback(
    (file: SerializedFile) => file.ownerId === userId || roleCanEdit(file.userRole),
    [userId],
  );

  // The backend stays the gate either way.
  const canModifyFolder = useCallback(
    (folderId: string) => {
      const folder = folders[folderId];
      if (!folder) return true;
      // Unknown owner (older cached rows): show the control and let the
      // backend gate, rather than hiding it from the actual owner.
      if (!folder.ownerId) return true;
      return !!userId && folder.ownerId === userId;
    },
    [folders, userId],
  );

  const bulkDeleteAllowed = useMemo(
    () =>
      selectedFileIds.every((id) => {
        const file = filesMap[id];
        return !file || canDeleteFile(file);
      }) && selectedFolderIds.every((id) => canModifyFolder(id)),
    [selectedFileIds, selectedFolderIds, filesMap, canDeleteFile, canModifyFolder],
  );

  // Check if all visible items are selected
  const totalItemCount = scopedFiles.length + scopedSubfolders.length;
  const allSelected = totalItemCount > 0 && totalSelectedCount === totalItemCount;
  const someSelected = totalSelectedCount > 0 && totalSelectedCount < totalItemCount;

  if (loading) {
    return <FilesListSkeleton viewMode={viewMode} />;
  }

  return (
    <div className="flex flex-col h-full" onContextMenu={handleContextMenu}>
      {/* Persistent Toolbar */}
      <div
        className={cn(
          "flex items-center justify-between px-3 md:px-4 py-2 border-b border-border gap-2",
          isSelectMode && "bg-primary/5",
        )}
      >
        {/* Left side: Sidebar toggle (mobile) + Selection/Count + Select button */}
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* Mobile sidebar toggle */}
          {isMobile && onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
              title="Show sidebar"
            >
              <SidebarSimple size={16} className="text-primary" />
            </button>
          )}

          {/* Select mode button (left side when not in select mode) */}
          {!isSelectMode && totalItemCount > 0 && (
            <button
              onClick={() => dispatch(setSelectMode(true))}
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="Select files"
            >
              <CheckSquare size={16} />
              <span className="hidden sm:inline text-sm">Select</span>
            </button>
          )}

          {/* Selection checkbox (only in select mode) or item count */}
          {isSelectMode ? (
            <>
              <button
                onClick={allSelected ? handleClearSelection : handleSelectAll}
                className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                title={allSelected ? "Clear selection" : "Select all"}
              >
                {allSelected ? (
                  <CheckSquare size={20} weight="fill" className="text-primary" />
                ) : someSelected ? (
                  <CheckSquare size={20} weight="duotone" className="text-primary" />
                ) : (
                  <Square size={20} weight="regular" className="text-muted-foreground" />
                )}
              </button>
              <span className="text-sm font-medium truncate">
                {totalSelectedCount > 0 ? `${totalSelectedCount} selected` : "Select items"}
              </span>
              {/* Exit select mode - X button next to selection info */}
              <button
                onClick={handleExitSelectMode}
                className="p-1 rounded-md hover:bg-muted transition-colors shrink-0"
                title="Exit select mode"
              >
                <X size={18} className="text-muted-foreground" />
              </button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground truncate">
              {scopedSubfolders.length > 0 &&
                `${scopedSubfolders.length} folder${scopedSubfolders.length !== 1 ? "s" : ""}`}
              {scopedSubfolders.length > 0 && scopedFiles.length > 0 && ", "}
              {scopedFiles.length > 0 &&
                `${scopedFiles.length} file${scopedFiles.length !== 1 ? "s" : ""}`}
              {scopedSubfolders.length === 0 && scopedFiles.length === 0 && "Empty"}
            </span>
          )}
        </div>

        {/* Right side: Bulk actions OR View controls */}
        <div className="flex items-center gap-1 md:gap-3 shrink-0">
          {isSelectMode ? (
            <>
              {/* Bulk bookmark */}
              <button
                onClick={handleBulkBookmark}
                disabled={bulkActionLoading || selectedFileIds.length === 0}
                className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                title="Bookmark selected"
              >
                <BookmarkSimple size={16} weight="duotone" />
                <span className="hidden md:inline">Bookmark</span>
              </button>

              {/* Bulk move */}
              <button
                onClick={handleBulkMove}
                disabled={bulkActionLoading || totalSelectedCount === 0}
                className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                title="Move selected"
              >
                <ArrowRight size={16} />
                <span className="hidden md:inline">Move</span>
              </button>

              {/* Bulk download as archive */}
              {(onBulkDownload || onDownload) && (
                <button
                  onClick={handleBulkDownload}
                  disabled={bulkActionLoading || totalSelectedCount === 0}
                  className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  title="Download selected files as zip"
                >
                  <FileArrowDown size={16} />
                  <span className="hidden md:inline">Download</span>
                </button>
              )}

              {/* Bulk delete */}
              <button
                onClick={handleBulkDelete}
                disabled={bulkActionLoading || totalSelectedCount === 0 || !bulkDeleteAllowed}
                className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                title={
                  bulkDeleteAllowed
                    ? "Delete selected"
                    : "Selection includes items you cannot delete"
                }
              >
                <Trash size={16} />
                <span className="hidden md:inline">Delete</span>
              </button>
            </>
          ) : (
            <>
              {/* Filter dropdown - hidden on mobile */}
              {savedFilters.length > 0 && (
                <div className="hidden sm:flex items-center gap-1">
                  <Select
                    value={activeFilterId ?? ""}
                    onChange={handleFilterChange}
                    options={filterOptions}
                    size="sm"
                    placeholder="Filter"
                  />
                  {activeFilterId && (
                    <button
                      onClick={() => {
                        dispatch(clearActiveFilter());
                      }}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Clear filter"
                    >
                      <X size={14} weight="bold" />
                    </button>
                  )}
                  <div className="h-6 w-px bg-border" />
                </div>
              )}

              {/* Sort controls - hidden on mobile */}
              <div className="hidden sm:flex items-center gap-1">
                <Select
                  value={sortBy}
                  onChange={(value) => dispatch(setSortBy(value as SortByValue))}
                  options={[...SORT_OPTIONS]}
                  size="sm"
                />

                <Select
                  value={sortOrder}
                  onChange={handleSortOrderChange}
                  options={[...SORT_ORDER_OPTIONS]}
                  size="sm"
                />

                <div className="h-6 w-px bg-border" />
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => dispatch(setViewMode("grid"))}
                  className={cn(
                    "px-2 py-1 rounded-md transition-colors",
                    viewMode === "grid"
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                  title="Grid view"
                >
                  <SquaresFour size={16} />
                </button>
                <button
                  onClick={() => dispatch(setViewMode("list"))}
                  className={cn(
                    "px-2 py-1 rounded-md transition-colors",
                    viewMode === "list"
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                  title="List view"
                >
                  <List size={16} />
                </button>
              </div>

              {/* Icon size slider (only visible in grid mode, hidden on mobile) */}
              {viewMode === "grid" && (
                <div className="hidden md:flex items-center gap-1">
                  <div className="h-6 w-px bg-border" />
                  <IconSizeSlider
                    value={iconSize}
                    onChange={(size) => dispatch(setIconSize(size))}
                  />
                </div>
              )}

              {/* Share button (visible when a file is selected) */}
              {currentFile && (
                <>
                  <div className="h-6 w-px bg-border" />
                  <button
                    onClick={() => handleShare(currentFile.id, currentFile.filename)}
                    className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
                    title="Share"
                  >
                    <ShareNetwork size={20} weight="duotone" className="text-primary" />
                  </button>
                </>
              )}

              {/* Details panel toggle */}
              <div className="h-6 w-px bg-border" />
              <button
                onClick={() => dispatch(toggleDetailsPanel())}
                className={cn(
                  "px-2 py-1 rounded-md transition-colors",
                  isDetailsPanelOpen
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                title={isDetailsPanelOpen ? "Hide details" : "Show details"}
              >
                <SidebarSimple size={16} className="transform -scale-x-100" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Folder breadcrumb */}
      {breadcrumbItems.length > 0 && (
        <nav className="flex items-center gap-1 px-4 py-1.5 text-sm text-muted-foreground border-b border-border bg-muted/30 min-w-0">
          <span
            onClick={() => handleBreadcrumbNavigate(null)}
            className="hover:text-foreground cursor-pointer hover:underline shrink-0"
          >
            Files
          </span>
          {breadcrumbItems.map((item, index) => {
            const isLast = index === breadcrumbItems.length - 1;
            return (
              <span key={item.id} className="flex items-center gap-1 min-w-0">
                <CaretRight size={12} weight="bold" className="shrink-0 text-subtle-foreground" />
                <span
                  onClick={() => !isLast && handleBreadcrumbNavigate(item.id)}
                  className={cn(
                    "truncate max-w-[200px]",
                    isLast
                      ? "text-foreground font-medium"
                      : "hover:text-foreground cursor-pointer hover:underline",
                  )}
                  title={item.name}
                >
                  {item.name}
                </span>
              </span>
            );
          })}
        </nav>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ActionMenu
          open
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          label="Folder actions"
        >
          <>
            {onUpload && (
              <ActionMenuItem
                onClick={() => {
                  onUpload();
                  setContextMenu(null);
                }}
              >
                <File size={16} weight="duotone" className="text-primary" />
                Upload Files
              </ActionMenuItem>
            )}
            {onUploadFolder && (
              <ActionMenuItem
                onClick={() => {
                  onUploadFolder();
                  setContextMenu(null);
                }}
              >
                <FolderOpen size={16} weight="duotone" className="text-primary" />
                Upload Folder
              </ActionMenuItem>
            )}
            {onCreateFolder && (
              <ActionMenuItem
                onClick={() => {
                  setContextMenu(null);
                  void handleCreateFolderClick();
                }}
              >
                <FolderPlus size={16} className="text-blue-500" />
                New Folder
              </ActionMenuItem>
            )}
          </>
        </ActionMenu>
      )}

      {/* Folders and Files */}
      {scopedFiles.length === 0 && scopedSubfolders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <Folder size={64} weight="duotone" className="mb-4 opacity-50" />
          {viewScope === "shared" ? (
            <>
              <p className="text-lg font-medium">Nothing shared with you yet</p>
              <p className="text-sm">Files and folders shared with you will appear here</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">No files yet</p>
              <p className="text-sm mb-4">Right-click to upload files or create a folder</p>
              <div className="flex items-center gap-2">
                {onUpload && (
                  <Button size="md" onClick={onUpload}>
                    <CloudArrowUp size={16} />
                    Upload Files
                  </Button>
                )}
                {onUploadFolder && (
                  <Button size="md" variant="outline" onClick={onUploadFolder}>
                    <FolderOpen size={16} weight="duotone" />
                    Upload Folder
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      ) : viewMode === "grid" ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${ICON_SIZE_CONFIG[iconSize as keyof typeof ICON_SIZE_CONFIG].cardMinWidth}px, 1fr))`,
              gap: `${ICON_SIZE_CONFIG[iconSize as keyof typeof ICON_SIZE_CONFIG].gap}px`,
            }}
          >
            {/* Folders first */}
            {scopedSubfolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onOpen={handleOpenFolder}
                onDelete={handleDeleteFolderAction}
                onDownload={handleDownloadFolder}
                onShare={handleShareFolder}
                onRename={handleRenameFolder}
                onMove={handleMoveFolder}
                viewMode="grid"
                viewScope={viewScope}
                sizeConfig={ICON_SIZE_CONFIG[iconSize as keyof typeof ICON_SIZE_CONFIG]}
                isSelectMode={isSelectMode}
                isChecked={selectedFolderIds.includes(folder.id)}
                onToggleCheck={handleToggleFolderCheck}
                canShare={canModifyFolder(folder.id)}
                canDelete={canModifyFolder(folder.id)}
                canEdit={canModifyFolder(folder.id)}
                autoRename={folder.id === pendingRenameFolderId}
                onAutoRenameResolved={handleAutoRenameResolved}
              />
            ))}
            {/* Then files */}
            {scopedFiles.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                isSelected={currentFileId === file.id}
                onSelect={handleSelectFile}
                onOpen={handleOpenFile}
                onDelete={handleDeleteFile}
                onDownload={handleDownload}
                onShare={handleShare}
                onRename={handleRenameFile}
                onUpdateTags={handleUpdateFileTags}
                onMove={handleMoveFile}
                viewMode="grid"
                viewScope={viewScope}
                sizeConfig={ICON_SIZE_CONFIG[iconSize as keyof typeof ICON_SIZE_CONFIG]}
                isSelectMode={isSelectMode}
                isChecked={selectedFileIds.includes(file.id)}
                onToggleCheck={handleToggleFileCheck}
                canShare={file.ownerId === userId}
                canDelete={canDeleteFile(file)}
                canEdit={canEditFile(file)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* List header */}
          <div className="flex items-center gap-4 px-3 md:px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/30">
            {/* Checkbox column (only in select mode) */}
            {isSelectMode && <div className="flex-shrink-0 w-5" />}
            <div className="w-8" />
            <div className="flex-1">Name</div>
            <div className="hidden lg:block w-36">Tags</div>
            {/* Owner column (only in shared/organization views) */}
            {(viewScope === "shared" || viewScope === "organization") && (
              <div className="hidden md:block w-28">Owner</div>
            )}
            <div className="w-24 text-right">Size</div>
            <div className="hidden lg:block w-20 text-right">Items</div>
            <div className="hidden sm:block w-24 text-right">Modified</div>
          </div>

          {/* Folders first */}
          {scopedSubfolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onOpen={handleOpenFolder}
              onDelete={handleDeleteFolderAction}
              onDownload={handleDownloadFolder}
              onShare={handleShareFolder}
              onRename={handleRenameFolder}
              onMove={handleMoveFolder}
              viewMode="list"
              viewScope={viewScope}
              isSelectMode={isSelectMode}
              isChecked={selectedFolderIds.includes(folder.id)}
              onToggleCheck={handleToggleFolderCheck}
              canShare={canModifyFolder(folder.id)}
              canDelete={canModifyFolder(folder.id)}
              canEdit={canModifyFolder(folder.id)}
              autoRename={folder.id === pendingRenameFolderId}
              onAutoRenameResolved={handleAutoRenameResolved}
            />
          ))}

          {/* Then files */}
          {scopedFiles.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              isSelected={currentFileId === file.id}
              onSelect={handleSelectFile}
              onOpen={handleOpenFile}
              onDelete={handleDeleteFile}
              onDownload={handleDownload}
              onShare={handleShare}
              onRename={handleRenameFile}
              onUpdateTags={handleUpdateFileTags}
              onMove={handleMoveFile}
              viewMode="list"
              viewScope={viewScope}
              isSelectMode={isSelectMode}
              isChecked={selectedFileIds.includes(file.id)}
              onToggleCheck={handleToggleFileCheck}
              canShare={file.ownerId === userId}
              canDelete={canDeleteFile(file)}
              canEdit={canEditFile(file)}
            />
          ))}
        </div>
      )}

      {/* Move Dialog */}
      <MoveDialog
        isOpen={moveDialogOpen}
        onClose={handleCloseMoveDialog}
        fileIds={moveFileIds}
        folderIds={moveFolderIds}
        currentAccessMode={moveCurrentAccessMode}
        currentFolderId={moveCurrentFolderId}
        itemName={moveItemName}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => {
          if (!deleteLoading) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleteLoading(true);
          try {
            if (pendingDelete.kind === "file") {
              await executeDeleteFile(pendingDelete.id);
            } else if (pendingDelete.kind === "folder") {
              await executeDeleteFolder(pendingDelete.id);
            } else {
              await executeBulkDelete(pendingDelete.fileIds, pendingDelete.folderIds);
            }
            setPendingDelete(null);
          } finally {
            setDeleteLoading(false);
          }
        }}
        title={
          pendingDelete?.kind === "folder"
            ? "Delete folder?"
            : pendingDelete?.kind === "bulk"
              ? "Delete selected items?"
              : "Delete file?"
        }
        message={
          pendingDelete?.kind === "folder"
            ? `"${pendingDelete.name}" and everything inside it will be moved to the trash.`
            : pendingDelete?.kind === "bulk"
              ? `${pendingDelete.folderIds.length + pendingDelete.fileIds.length} item${pendingDelete.folderIds.length + pendingDelete.fileIds.length === 1 ? "" : "s"} will be moved to the trash. Folders will be deleted recursively.`
              : `"${pendingDelete?.name ?? "This file"}" will be moved to the trash.`
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLoading}
      />
    </div>
  );
}
