/**
 * Files List Component
 *
 * Displays files in grid or list view with sorting and filtering.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
    Folder,
    FolderPlus,
    List,
    SquaresFour,
    ArrowsClockwise,
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
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { renderIcon } from '@/components/icon-picker';
import { useNavigate } from 'react-router-dom';
import { useSavedFilters } from '@/features/files/hooks/useSavedFilters';
import { useApplyFilter } from '@/features/files/hooks/useApplyFilter';
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
} from '@/features/files/store/filesSlice';
import { openViewer } from '@/features/files/store/viewerSlice';
import { updateFile } from '@/features/files/store/filesThunks';
import { IconSizeSlider } from '@/features/files/components/list/IconSizeSlider';
import { setSelectedFolder, deleteFolder, updateFolder, fetchFilesTree } from '@/features/files/store/filesTreeSlice';
import { selectSubfoldersForCurrentFolder } from '@/features/files/store/selectors';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import type { SerializedTreeNode, SerializedFolder } from '@/features/files/store/filesTreeThunks';
import { useSharingDialog, useMyPermission } from '@/features/sharing';
import { toggleBookmark } from '@/features/bookmarks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ContentType, VisibilityScope } from '@/gen/common/v1/common_pb';
import type { FileDownloadItem } from '@/features/files/utils/archiveDownload';
import { collectAllDownloadFiles, createFileInfoArray } from '@/features/files/utils/folderDownload';
import { FolderCard } from '@/features/files/components/list/FolderCard';
import { FileCard } from '@/features/files/components/list/FileCard';
import { MoveDialog } from '@/features/files/components/list/MoveDialog';
import { ICON_SIZE_CONFIG, SORT_OPTIONS, SORT_ORDER_OPTIONS, type SortByValue, type SortOrderValue } from '@/features/files/components/list/constants';
import { FilesListSkeleton } from '@/features/files/components/list/FilesListSkeleton';

/**
 * Build breadcrumb path by walking up folder parentId chain.
 */
function buildFolderBreadcrumb(
    folders: Record<string, SerializedFolder>,
    currentFolderId: string | null,
): Array<{ id: string; name: string }> {
    if (!currentFolderId || currentFolderId === 'all') return [];

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

interface FilesListProps {
    files: SerializedFile[];
    allFiles?: SerializedFile[]; // All files in store (for folder download)
    loading?: boolean;
    onDownload?: (fileId: string) => void;
    onBulkDownload?: (items: FileDownloadItem[]) => Promise<void>;
    onUpload?: () => void;
    onCreateFolder?: () => void;
    onToggleSidebar?: () => void;
    folderTree?: {
        personal: SerializedTreeNode[];
        shared: SerializedTreeNode[];
        organization: SerializedTreeNode[];
    };
}

export function FilesList({ files, allFiles, loading, onDownload, onBulkDownload, onUpload, onCreateFolder, onToggleSidebar, folderTree }: FilesListProps) {
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

    // Get current file for share button
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

    // Get subfolders for current folder
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
                navigate('/files');
            }
        },
        [dispatch, navigate]
    );

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    // Bulk action loading state
    const [bulkActionLoading, setBulkActionLoading] = useState(false);

    // Move dialog state
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveFileIds, setMoveFileIds] = useState<string[]>([]);
    const [moveFolderIds, setMoveFolderIds] = useState<string[]>([]);
    const [moveItemName, setMoveItemName] = useState<string | undefined>();
    const [moveCurrentVisibility, setMoveCurrentVisibility] = useState<VisibilityScope | undefined>();
    const [moveCurrentFolderId, setMoveCurrentFolderId] = useState<string | null | undefined>();

    // Sharing dialog
    const { open: openSharingDialog } = useSharingDialog();

    // Check if current user can share the selected file
    const { permission: filePermission } = useMyPermission(
        ContentType.FILE,
        currentFile?.id ?? null
    );

    // Close context menu on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        if (contextMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [contextMenu]);

    // Close context menu on escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setContextMenu(null);
            }
        };
        if (contextMenu) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [contextMenu]);

    // Handle right-click on files area
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        // Don't show context menu in "Shared With Me" view
        if (viewScope === 'shared') {
            return;
        }
        setContextMenu({ x: e.clientX, y: e.clientY });
    }, [viewScope]);

    // Sort files
    const sortedFiles = useMemo(() => {
        const sorted = [...files].sort((a, b) => {
            let comparison = 0;
            switch (sortBy) {
                case 'filename':
                    comparison = a.filename.localeCompare(b.filename);
                    break;
                case 'size_bytes':
                    comparison = a.sizeBytes - b.sizeBytes;
                    break;
                case 'created_at':
                    comparison = (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
                    break;
                case 'updated_at':
                default:
                    comparison = (a.updatedAt?.seconds ?? 0) - (b.updatedAt?.seconds ?? 0);
                    break;
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });
        return sorted;
    }, [files, sortBy, sortOrder]);

    // Filter out deleted files
    const activeFiles = useMemo(() => sortedFiles.filter(f => !f.isDeleted), [sortedFiles]);

    // Filter files by view scope
    const scopedFiles = useMemo(() => {
        console.log('[FilesList] Filtering files', {
            viewScope,
            userId,
            totalFiles: activeFiles.length,
            filesWithVisibility: activeFiles.map(f => ({ name: f.filename, visibility: f.visibility, ownerId: f.ownerId }))
        });

        if (viewScope === 'all') {
            return activeFiles;
        }

        if (viewScope === 'personal') {
            const filtered = activeFiles.filter(f =>
                f.visibility === VisibilityScope.PRIVATE &&
                f.ownerId === userId
            );
            console.log('[FilesList] Personal filter result:', filtered.length, 'files');
            return filtered;
        }

        if (viewScope === 'shared') {
            // Selector already filters for shared files (not owned by user, not org-wide)
            // No additional filtering needed here
            console.log('[FilesList] Shared filter result:', activeFiles.length, 'files');
            return activeFiles;
        }

        if (viewScope === 'organization') {
            const filtered = activeFiles.filter(f =>
                f.visibility === VisibilityScope.ORGANIZATION
            );
            console.log('[FilesList] Organization filter result:', filtered.length, 'files');
            return filtered;
        }

        return activeFiles;
    }, [activeFiles, viewScope, userId]);

    // Filter subfolders by view scope
    const scopedSubfolders = useMemo(() => {
        console.log('[FilesList] Filtering subfolders', {
            viewScope,
            userId,
            totalSubfolders: subfolders.length,
            subfoldersWithVisibility: subfolders.map(f => ({ name: f.name, visibility: f.visibility }))
        });

        if (viewScope === 'all') {
            return subfolders;
        }

        if (viewScope === 'personal') {
            const filtered = subfolders.filter(f =>
                f.visibility === VisibilityScope.PRIVATE
            );
            console.log('[FilesList] Personal subfolders result:', filtered.length);
            return filtered;
        }

        if (viewScope === 'shared') {
            // For shared view, only show folders with GROUP visibility
            // (ORGANIZATION folders are in org view, PRIVATE folders are personal)
            const filtered = subfolders.filter(f =>
                f.visibility === VisibilityScope.GROUP
            );
            console.log('[FilesList] Shared subfolders result:', filtered.length);
            return filtered;
        }

        if (viewScope === 'organization') {
            const filtered = subfolders.filter(f =>
                f.visibility === VisibilityScope.ORGANIZATION
            );
            console.log('[FilesList] Organization subfolders result:', filtered.length);
            return filtered;
        }

        return subfolders;
    }, [subfolders, viewScope, userId]);

    // Single click - just select the file (for details panel)
    const handleSelectFile = useCallback(
        (fileId: string) => {
            dispatch(setCurrentFile(fileId));
        },
        [dispatch]
    );

    // Double click - open the file viewer
    const handleOpenFile = useCallback(
        (fileId: string) => {
            dispatch(setCurrentFile(fileId));
            const playlist = scopedFiles.map(f => f.id);
            dispatch(openViewer({ fileId, playlist }));
        },
        [dispatch, scopedFiles]
    );

    const handleDeleteFile = useCallback(
        async (fileId: string) => {
            await dispatch(deleteFile({ fileId }));
            dispatch(fetchFilesTree({ includeFiles: false }));
        },
        [dispatch]
    );

    const handleDownload = useCallback(
        (fileId: string) => {
            onDownload?.(fileId);
        },
        [onDownload]
    );

    const handleShare = useCallback(
        (fileId: string, filename: string) => {
            openSharingDialog(ContentType.FILE, fileId, filename);
        },
        [openSharingDialog]
    );

    const handleRenameFile = useCallback(
        async (fileId: string, newName: string) => {
            await dispatch(updateFile({ fileId, filename: newName }));
        },
        [dispatch]
    );

    // Move file handler (single file from context menu)
    const handleMoveFile = useCallback(
        (fileId: string) => {
            const file = filesMap[fileId];
            if (file) {
                setMoveFileIds([fileId]);
                setMoveFolderIds([]);
                setMoveItemName(file.filename);
                setMoveCurrentVisibility(file.visibility as VisibilityScope);
                setMoveCurrentFolderId(file.folderId ?? null);
                setMoveDialogOpen(true);
            }
        },
        [filesMap]
    );

    // Move folder handler (single folder from context menu)
    const handleMoveFolder = useCallback(
        (folderId: string) => {
            // Find folder in the tree
            const findFolder = (nodes: SerializedTreeNode[]): SerializedTreeNode | null => {
                for (const node of nodes) {
                    if (node.id === folderId) return node;
                    if (node.children) {
                        const found = findFolder(node.children);
                        if (found) return found;
                    }
                }
                return null;
            };

            const folder = folderTree
                ? findFolder(folderTree.personal) ||
                  findFolder(folderTree.organization) ||
                  findFolder(folderTree.shared)
                : null;

            if (folder) {
                setMoveFileIds([]);
                setMoveFolderIds([folderId]);
                setMoveItemName(folder.name);
                setMoveCurrentVisibility(folder.visibility as VisibilityScope);
                setMoveCurrentFolderId(folder.parentId ?? null);
                setMoveDialogOpen(true);
            }
        },
        [folderTree]
    );

    // Bulk move handler
    const handleBulkMove = useCallback(() => {
        setMoveFileIds([...selectedFileIds]);
        setMoveFolderIds([...selectedFolderIds]);
        setMoveItemName(undefined);
        setMoveCurrentVisibility(undefined);
        setMoveCurrentFolderId(undefined);
        setMoveDialogOpen(true);
    }, [selectedFileIds, selectedFolderIds]);

    // Close move dialog
    const handleCloseMoveDialog = useCallback(() => {
        setMoveDialogOpen(false);
        setMoveFileIds([]);
        setMoveFolderIds([]);
        setMoveItemName(undefined);
        setMoveCurrentVisibility(undefined);
        setMoveCurrentFolderId(undefined);
        // Clear selection after successful move
        dispatch(clearSelection());
    }, [dispatch]);

    const handleUpdateFileTags = useCallback(
        async (fileId: string, tags: string[]) => {
            await dispatch(updateFile({ fileId, tags }));
        },
        [dispatch]
    );

    // Handle opening a folder
    const handleOpenFolder = useCallback(
        (folderId: string) => {
            dispatch(setSelectedFolder(folderId));
            dispatch(setFolderId(folderId));
            navigate(`/files?folder=${folderId}`);
        },
        [dispatch, navigate]
    );

    const handleSortOrderChange = useCallback((value: SortOrderValue) => {
        dispatch(setSortOrder(value));
    }, [dispatch]);

    // Filter dropdown options
    const filterOptions = useMemo((): SelectOption<string>[] => {
        const options: SelectOption<string>[] = [
            { value: '', label: 'All Files', icon: <Funnel size={14} weight="regular" /> },
        ];
        savedFilters.forEach(filter => {
            // Use custom icon if available, otherwise default Funnel
            let icon: React.ReactNode;
            if (filter.icon) {
                if (filter.icon.type === 'emoji') {
                    icon = <span className="text-sm leading-none">{filter.icon.value}</span>;
                } else {
                    icon = renderIcon(filter.icon, undefined, 14);
                }
            } else {
                icon = <Funnel size={14} weight={filter.isPreset ? 'fill' : 'duotone'} className="text-primary" />;
            }
            options.push({
                value: filter.id,
                label: filter.name,
                icon,
            });
        });
        return options;
    }, [savedFilters]);

    // Handle filter selection from dropdown
    const handleFilterChange = useCallback((filterId: string) => {
        if (!filterId) {
            // Clear filter (preserve current folder)
            dispatch(clearActiveFilter());
        } else {
            // Find and apply the filter
            const filter = savedFilters.find(f => f.id === filterId);
            if (filter) {
                applyFilter(filter);
            }
        }
    }, [dispatch, savedFilters, applyFilter]);

    // File selection handlers
    const handleToggleFileCheck = useCallback(
        (fileId: string, shiftKey: boolean) => {
            // Shift+click: select range from last selected file to current
            if (shiftKey && lastSelectedId && lastSelectedType === 'file' && lastSelectedId !== fileId) {
                const startIndex = scopedFiles.findIndex(f => f.id === lastSelectedId);
                const endIndex = scopedFiles.findIndex(f => f.id === fileId);

                if (startIndex !== -1 && endIndex !== -1) {
                    const fromIndex = Math.min(startIndex, endIndex);
                    const toIndex = Math.max(startIndex, endIndex);
                    const rangeFileIds = scopedFiles.slice(fromIndex, toIndex + 1).map(f => f.id);
                    dispatch(selectFileRange({ fileIds: rangeFileIds, anchorId: fileId }));
                    return;
                }
            }

            // Normal click: toggle single file
            dispatch(toggleFileSelection(fileId));
        },
        [dispatch, lastSelectedId, lastSelectedType, scopedFiles]
    );

    // Folder selection handlers
    const handleToggleFolderCheck = useCallback(
        (folderId: string, shiftKey: boolean) => {
            // Shift+click: select range from last selected folder to current
            if (shiftKey && lastSelectedId && lastSelectedType === 'folder' && lastSelectedId !== folderId) {
                const startIndex = scopedSubfolders.findIndex(f => f.id === lastSelectedId);
                const endIndex = scopedSubfolders.findIndex(f => f.id === folderId);

                if (startIndex !== -1 && endIndex !== -1) {
                    const fromIndex = Math.min(startIndex, endIndex);
                    const toIndex = Math.max(startIndex, endIndex);
                    const rangeFolderIds = scopedSubfolders.slice(fromIndex, toIndex + 1).map(f => f.id);
                    dispatch(selectFolderRange({ folderIds: rangeFolderIds, anchorId: folderId }));
                    return;
                }
            }

            // Normal click: toggle single folder
            dispatch(toggleFolderSelection(folderId));
        },
        [dispatch, lastSelectedId, lastSelectedType, scopedSubfolders]
    );

    const handleSelectAll = useCallback(() => {
        const allFileIds = scopedFiles.map(f => f.id);
        const allFolderIds = scopedSubfolders.map(f => f.id);
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
    const handleBulkDelete = useCallback(async () => {
        if (totalSelectedCount === 0) return;
        setBulkActionLoading(true);
        try {
            // Delete folders first
            for (const folderId of selectedFolderIds) {
                await dispatch(deleteFolder({ folderId, recursive: true }));
            }
            // Then delete files
            for (const fileId of selectedFileIds) {
                await dispatch(deleteFile({ fileId }));
            }
            dispatch(clearSelection());
            dispatch(fetchFilesTree({ includeFiles: false }));
        } finally {
            setBulkActionLoading(false);
        }
    }, [dispatch, selectedFileIds, selectedFolderIds, totalSelectedCount]);

    // Build a file info array for folder content lookup (use allFiles for recursive downloads)
    const filesForDownload = allFiles || files;
    const allFilesInfo = useMemo(() => createFileInfoArray(
        filesForDownload.reduce((acc, f) => {
            acc[f.id] = { id: f.id, filename: f.filename, folderId: f.folderId };
            return acc;
        }, {} as Record<string, { id: string; filename: string; folderId?: string }>)
    ), [filesForDownload]);

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
                        allFilesInfo
                    );
                    downloadItems = filesWithPaths;
                } else {
                    // Just selected files (no folders or no tree available)
                    downloadItems = selectedFileIds.map(id => ({ fileId: id }));
                }

                if (downloadItems.length > 0) {
                    await onBulkDownload(downloadItems);
                }
            } finally {
                setBulkActionLoading(false);
            }
        } else if (onDownload) {
            // Fallback: download files individually (only selected files, not folder contents)
            selectedFileIds.forEach(fileId => onDownload(fileId));
        }
    }, [selectedFileIds, selectedFolderIds, onBulkDownload, onDownload, folderTree, allFilesInfo]);

    // Folder action handlers (must be after allFilesInfo is defined)
    const handleDeleteFolderAction = useCallback(
        async (folderId: string) => {
            await dispatch(deleteFolder({ folderId, recursive: true }));
            dispatch(fetchFilesTree({ includeFiles: false }));
        },
        [dispatch]
    );

    const handleDownloadFolder = useCallback(
        async (folderId: string) => {
            if (!onBulkDownload || !folderTree) return;

            // Collect all files in this folder and scopedSubfolders
            const filesWithPaths = collectAllDownloadFiles(
                [],
                [folderId],
                folderTree,
                allFilesInfo
            );

            if (filesWithPaths.length > 0) {
                await onBulkDownload(filesWithPaths);
            }
        },
        [onBulkDownload, folderTree, allFilesInfo]
    );

    const handleShareFolder = useCallback(
        (folderId: string, folderName: string) => {
            openSharingDialog(ContentType.FOLDER, folderId, folderName);
        },
        [openSharingDialog]
    );

    const handleRenameFolder = useCallback(
        async (folderId: string, newName: string) => {
            await dispatch(updateFolder({ folderId, name: newName }));
        },
        [dispatch]
    );

    const handleBulkBookmark = useCallback(async () => {
        // Only bookmark files for now
        if (selectedFileIds.length === 0) return;
        setBulkActionLoading(true);
        try {
            for (const fileId of selectedFileIds) {
                const fileUrn = `urn:uniffy:content:FILE:${fileId}`;
                await dispatch(toggleBookmark(fileUrn));
            }
        } finally {
            setBulkActionLoading(false);
        }
    }, [dispatch, selectedFileIds]);

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
            <div className={cn(
                "flex items-center justify-between px-3 md:px-4 py-2 border-b border-border gap-2",
                isSelectMode && "bg-primary/5"
            )}>
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
                                title={allSelected ? 'Clear selection' : 'Select all'}
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
                                {totalSelectedCount > 0 ? `${totalSelectedCount} selected` : 'Select items'}
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
                            {scopedSubfolders.length > 0 && `${scopedSubfolders.length} folder${scopedSubfolders.length !== 1 ? 's' : ''}`}
                            {scopedSubfolders.length > 0 && scopedFiles.length > 0 && ', '}
                            {scopedFiles.length > 0 && `${scopedFiles.length} file${scopedFiles.length !== 1 ? 's' : ''}`}
                            {scopedSubfolders.length === 0 && scopedFiles.length === 0 && 'Empty'}
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
                                disabled={bulkActionLoading || totalSelectedCount === 0}
                                className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                                title="Delete selected"
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
                                        value={activeFilterId ?? ''}
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
                                    onClick={() => dispatch(setViewMode('grid'))}
                                    className={cn(
                                        'px-2 py-1 rounded-md transition-colors',
                                        viewMode === 'grid'
                                            ? 'text-primary bg-primary/10'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                    )}
                                    title="Grid view"
                                >
                                    <SquaresFour size={16} />
                                </button>
                                <button
                                    onClick={() => dispatch(setViewMode('list'))}
                                    className={cn(
                                        'px-2 py-1 rounded-md transition-colors',
                                        viewMode === 'list'
                                            ? 'text-primary bg-primary/10'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                    )}
                                    title="List view"
                                >
                                    <List size={16} />
                                </button>
                            </div>

                            {/* Icon size slider (only visible in grid mode, hidden on mobile) */}
                            {viewMode === 'grid' && (
                                <div className="hidden md:flex items-center gap-1">
                                    <div className="h-6 w-px bg-border" />
                                    <IconSizeSlider
                                        value={iconSize}
                                        onChange={(size) => dispatch(setIconSize(size))}
                                    />
                                </div>
                            )}

                            {/* Share button (visible when a file is selected and user can share) */}
                            {currentFile && filePermission?.canShare && (
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
                                    'px-2 py-1 rounded-md transition-colors',
                                    isDetailsPanelOpen
                                        ? 'text-primary bg-primary/10'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                )}
                                title={isDetailsPanelOpen ? 'Hide details' : 'Show details'}
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
                                <CaretRight size={12} weight="bold" className="shrink-0 text-muted-foreground/50" />
                                <span
                                    onClick={() => !isLast && handleBreadcrumbNavigate(item.id)}
                                    className={cn(
                                        'truncate max-w-[200px]',
                                        isLast
                                            ? 'text-foreground font-medium'
                                            : 'hover:text-foreground cursor-pointer hover:underline',
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
                <div
                    ref={contextMenuRef}
                    className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <div className="py-1">
                        {onUpload && (
                            <button
                                onClick={() => {
                                    onUpload();
                                    setContextMenu(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                            >
                                <CloudArrowUp size={16} className="text-primary" />
                                Upload Files
                            </button>
                        )}
                        {onCreateFolder && (
                            <button
                                onClick={() => {
                                    onCreateFolder();
                                    setContextMenu(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                            >
                                <FolderPlus size={16} className="text-blue-500" />
                                New Folder
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Folders and Files */}
            {scopedFiles.length === 0 && scopedSubfolders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <Folder size={64} weight="duotone" className="mb-4 opacity-50" />
                    {viewScope === 'shared' ? (
                        <>
                            <p className="text-lg font-medium">Nothing shared with you yet</p>
                            <p className="text-sm">Files and folders shared with you will appear here</p>
                        </>
                    ) : (
                        <>
                            <p className="text-lg font-medium">No files yet</p>
                            <p className="text-sm mb-4">Right-click to upload files or create a folder</p>
                            {onUpload && (
                                <Button size="md" onClick={onUpload}>
                                    <CloudArrowUp size={16} />
                                    Upload Files
                                </Button>
                            )}
                        </>
                    )}
                </div>
            ) : viewMode === 'grid' ? (
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
                                canShare={true}
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
                        {(viewScope === 'shared' || viewScope === 'organization') && (
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
                            canShare={true}
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
                currentVisibility={moveCurrentVisibility}
                currentFolderId={moveCurrentFolderId}
                itemName={moveItemName}
            />
        </div>
    );
}
