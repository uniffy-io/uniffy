/**
 * Files Sidebar Component
 *
 * Displays the folder tree organized by visibility scope.
 * Supports creating folders and navigating the file tree.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
    CaretDown,
    CaretRight,
    CaretDoubleLeft,
    Folder,
    FolderPlus,
    LockSimple,
    Buildings,
    Trash,
    PencilSimple,
    ArrowsClockwise,
    SquaresFour,
    BookmarkSimple,
    File,
    CloudArrowUp,
    CloudArrowDown,
    UsersThree,
    ArrowUUpLeft,
    Funnel,
    Tag,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { VisibilityScope } from '@/gen/common/v1/common_pb';
import { useBookmarks } from '@/features/bookmarks';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import { filesApi } from '@/features/files/api/filesApi';
import {
    toggleNodeExpanded,
    setSelectedFolder,
    setBookmarkedNodes,
    fetchFilesTree,
    createFolder,
    updateFolder,
    deleteFolder,
} from '@/features/files/store/filesTreeSlice';
import { setFolderId, setViewScope, initializeFilesData, restoreFile } from '@/features/files/store/filesSlice';
import { openViewer } from '@/features/files/store/viewerSlice';
import { selectDeletedFiles } from '@/features/files/store/selectors';
import { toggleUploadPanel } from '@/features/files/store/uploadSlice';
import type { SerializedTreeNode } from '@/features/files/store/filesTreeThunks';

// Scope filter configuration
interface ScopeFilterConfig {
    id: 'all' | 'personal' | 'shared' | 'organization';
    name: string;
    icon: typeof Folder;
}

const SCOPE_FILTERS: ScopeFilterConfig[] = [
    { id: 'all', name: 'All Files', icon: SquaresFour },
    { id: 'personal', name: 'Personal Space', icon: LockSimple },
    { id: 'shared', name: 'Shared With Me', icon: UsersThree },
    { id: 'organization', name: 'Organization', icon: Buildings },
];

// Section config for bookmarks
interface SectionConfig {
    id: 'bookmarked';
    name: string;
    icon: typeof Folder;
}

const BOOKMARKS_SECTION: SectionConfig = { id: 'bookmarked', name: 'Bookmarks', icon: BookmarkSimple };

// Files navigation items
interface FilesNavItem {
    name: string;
    path: string;
    icon: Icon;
}

const filesNavItems: FilesNavItem[] = [
    { name: 'All Files', path: '/files', icon: SquaresFour },
    { name: 'Tags', path: '/files/tags', icon: Tag },
    { name: 'Filters', path: '/files/filters', icon: Funnel },
];

/**
 * Compact nav item that expands on hover to show label.
 */
function CompactNavItem({ item, isActive }: { item: FilesNavItem; isActive: boolean }) {
    const IconComponent = item.icon;

    return (
        <Link
            to={item.path}
            className={cn(
                "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
                "hover:px-2.5",
                isActive && "text-foreground"
            )}
        >
            {/* Active indicator */}
            <span
                className={cn(
                    "absolute inset-0 rounded-lg transition-all duration-500",
                    isActive ? "bg-primary/10" : "bg-transparent"
                )}
            />

            {/* Hover underline effect */}
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

            {/* Icon */}
            <span className={cn(
                "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
                isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground group-hover:text-primary"
            )}>
                <IconComponent size={18} weight={isActive ? "fill" : "duotone"} />
            </span>

            {/* Label - hidden by default, shows on hover */}
            <span className={cn(
                "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
                "group-hover:ml-1.5 group-hover:max-w-24",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
            )}>
                {item.name}
            </span>
        </Link>
    );
}

/**
 * Files submenu navigation component.
 */
function FilesSubmenu() {
    const location = useLocation();

    return (
        <div className="px-3 py-2 border-b border-border">
            <nav className="flex items-center gap-0.5">
                {filesNavItems.map((item) => {
                    // Check if current path matches item path
                    const isActive = item.path === '/files'
                        ? location.pathname === '/files' && !location.search.includes('folder=')
                        : location.pathname === item.path;

                    return (
                        <CompactNavItem key={item.path} item={item} isActive={isActive} />
                    );
                })}
            </nav>
        </div>
    );
}

/**
 * Tree node component for folders.
 */
function FolderNode({
    node,
    depth = 0,
    isExpanded,
    isSelected,
    onToggle,
    onSelect,
    onRename,
    onDelete,
    onCreateSubfolder,
    editingId,
    onStartEdit,
    onCancelEdit,
    isNodeExpanded,
}: {
    node: SerializedTreeNode;
    depth?: number;
    isExpanded: boolean;
    isSelected: boolean;
    onToggle: (id: string) => void;
    onSelect: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onCreateSubfolder: (parentId: string) => void;
    editingId: string | null;
    onStartEdit: (id: string) => void;
    onCancelEdit: () => void;
    isNodeExpanded: (nodeId: string) => boolean;
}) {
    const isEditing = editingId === node.id;
    const hasChildren = node.children && node.children.length > 0;

    // Local edit state - only relevant when isEditing is true
    const [editValue, setEditValue] = useState(node.name);

    // Reset edit value when starting to edit (called from event handler)
    const handleStartEdit = useCallback(() => {
        setEditValue(node.name);
        onStartEdit(node.id);
    }, [node.name, node.id, onStartEdit]);

    const handleSubmitRename = () => {
        if (editValue.trim() && editValue !== node.name) {
            onRename(node.id, editValue.trim());
        }
        onCancelEdit();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmitRename();
        } else if (e.key === 'Escape') {
            setEditValue(node.name);
            onCancelEdit();
        }
    };

    // Only render folders
    if (!node.isFolder) return null;

    return (
        <div>
            <div
                className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer",
                    isSelected && "bg-accent ring-1 ring-primary/30"
                )}
                onClick={() => onSelect(node.id)}
            >
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle(node.id);
                    }}
                    className="flex items-center"
                >
                    {hasChildren ? (
                        isExpanded ? (
                            <CaretDown size={14} weight="bold" className="text-muted-foreground" />
                        ) : (
                            <CaretRight size={14} weight="bold" className="text-muted-foreground" />
                        )
                    ) : (
                        <span className="w-3.5" />
                    )}
                </button>

                <Folder size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />

                {isEditing ? (
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSubmitRename}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="flex-1 bg-background border border-input rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                ) : (
                    <span className="flex-1 truncate">{node.name}</span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            onCreateSubfolder(node.id);
                        }}
                        className="p-0.5 rounded hover:bg-muted cursor-pointer"
                        title="New subfolder"
                    >
                        <FolderPlus size={14} weight="duotone" className="text-muted-foreground" />
                    </span>
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit();
                        }}
                        className="p-0.5 rounded hover:bg-muted cursor-pointer"
                        title="Rename"
                    >
                        <PencilSimple size={14} weight="duotone" className="text-muted-foreground" />
                    </span>
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(node.id);
                        }}
                        className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                        title="Delete"
                    >
                        <Trash size={14} weight="duotone" className="text-destructive" />
                    </span>
                </div>
            </div>

            {/* Children */}
            {isExpanded && hasChildren && (
                <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5">
                    {node.children!.filter(c => c.isFolder).map((child) => (
                        <FolderNode
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            isExpanded={isNodeExpanded(child.id)}
                            isSelected={false}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            onRename={onRename}
                            onDelete={onDelete}
                            onCreateSubfolder={onCreateSubfolder}
                            editingId={editingId}
                            onStartEdit={onStartEdit}
                            onCancelEdit={onCancelEdit}
                            isNodeExpanded={isNodeExpanded}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface FilesSidebarProps {
    onToggleSidebar?: () => void;
    onUpload?: () => void;
}

/**
 * Main Files Sidebar component.
 */
export function FilesSidebar({ onToggleSidebar, onUpload }: FilesSidebarProps) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();

    // Redux state
    const tree = useAppSelector((state) => state.filesTree.tree);
    const expandedNodes = useAppSelector((state) => state.filesTree.expandedNodes);
    const selectedFolderId = useAppSelector((state) => state.filesTree.selectedFolderId);
    const loading = useAppSelector((state) => state.filesTree.loading);
    const error = useAppSelector((state) => state.filesTree.error);
    const viewScope = useAppSelector((state) => state.files.filters.viewScope);

    // Local state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showTrash, setShowTrash] = useState(false);
    const [restoringFileId, setRestoringFileId] = useState<string | null>(null);
    const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
    const [emptyingTrash, setEmptyingTrash] = useState(false);
    const [emptyTrashError, setEmptyTrashError] = useState<string | null>(null);

    // Bookmarks state
    useBookmarks(); // Auto-fetches bookmarks on organization change
    const bookmarkedUrns = useAppSelector((state) => state.bookmarks.bookmarkedUrns);
    const files = useAppSelector((state) => state.files.files);

    // Trash state (deleted files)
    const deletedFiles = useAppSelector(selectDeletedFiles);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    // Upload/Download status
    const isUploading = useAppSelector((state) => state.upload.isUploading);
    const isDownloading = useAppSelector((state) => state.upload.isDownloading);
    const showPanel = useAppSelector((state) => state.upload.showUploadPanel);
    const activeUploadCount = useAppSelector((state) =>
        Object.keys(state.upload.activeUploads).length + state.upload.queue.length
    );
    const activeDownloadCount = useAppSelector((state) =>
        Object.keys(state.upload.activeDownloads).length
    );
    const hasTransferActivity = isUploading || isDownloading;

    // Populate bookmarked section from bookmarks store
    useEffect(() => {
        // Find all files whose URNs are bookmarked
        const bookmarkedFileIds = Object.keys(bookmarkedUrns)
            .filter(urn => bookmarkedUrns[urn] && urn.includes(':FILE:'))
            .map(urn => urn.split(':FILE:')[1]);

        // Build tree nodes for bookmarked files
        const bookmarkedNodes: SerializedTreeNode[] = bookmarkedFileIds
            .map(fileId => {
                const file = files[fileId];
                if (!file) return null;
                return {
                    id: file.id,
                    name: file.filename,
                    isFolder: false,
                    parentId: file.folderId,
                    visibility: file.visibility,
                    childCount: 0,
                    children: [],
                } as SerializedTreeNode;
            })
            .filter((node): node is SerializedTreeNode => node !== null);

        dispatch(setBookmarkedNodes(bookmarkedNodes));
    }, [bookmarkedUrns, files, dispatch]);

    // Helper to find path to a folder (all parent IDs)
    const findPathToFolder = useCallback((folderId: string): string[] => {
        const path: string[] = [];

        const findInNodes = (nodes: SerializedTreeNode[], targetId: string, currentPath: string[]): boolean => {
            for (const node of nodes) {
                if (node.id === targetId) {
                    path.push(...currentPath);
                    return true;
                }
                if (node.children) {
                    if (findInNodes(node.children, targetId, [...currentPath, node.id])) {
                        return true;
                    }
                }
            }
            return false;
        };

        // Search in all sections
        findInNodes(tree.personal, folderId, ['personal']);
        findInNodes(tree.organization, folderId, ['organization']);

        return path;
    }, [tree]);

    // Auto-expand path to selected folder when it changes
    useEffect(() => {
        if (selectedFolderId) {
            const pathToExpand = findPathToFolder(selectedFolderId);
            // Expand all nodes in the path that aren't already expanded
            for (const nodeId of pathToExpand) {
                if (!expandedNodes.includes(nodeId)) {
                    dispatch(toggleNodeExpanded(nodeId));
                }
            }
        }
    }, [selectedFolderId, findPathToFolder, expandedNodes, dispatch]);

    // Check if node is expanded
    const isExpanded = useCallback(
        (id: string) => expandedNodes.includes(id),
        [expandedNodes]
    );

    // Toggle node expansion
    const handleToggle = useCallback(
        (id: string) => {
            dispatch(toggleNodeExpanded(id));
        },
        [dispatch]
    );

    // Select a folder - navigate to it
    const handleSelectFolder = useCallback(
        (folderId: string | null) => {
            dispatch(setSelectedFolder(folderId));
            dispatch(setFolderId(folderId));
            // Navigate to files with folder filter
            if (folderId) {
                navigate(`/files?folder=${folderId}`);
            } else {
                navigate('/files');
            }
        },
        [dispatch, navigate]
    );

    // Create a new folder
    const handleNewFolder = useCallback(
        async (visibility: VisibilityScope, parentId?: string) => {
            try {
                const result = await dispatch(
                    createFolder({
                        name: 'New Folder',
                        parentId,
                        visibility,
                    })
                ).unwrap();

                // Start editing the name
                setEditingId(result.id);

                // Expand parent if creating subfolder
                if (parentId && !expandedNodes.includes(parentId)) {
                    dispatch(toggleNodeExpanded(parentId));
                }
            } catch (err) {
                console.error('Failed to create folder:', err);
            }
        },
        [dispatch, expandedNodes]
    );

    // Create subfolder
    const handleCreateSubfolder = useCallback(
        (parentId: string) => {
            // Get parent's visibility
            const findNode = (nodes: SerializedTreeNode[]): SerializedTreeNode | null => {
                for (const node of nodes) {
                    if (node.id === parentId) return node;
                    if (node.children) {
                        const found = findNode(node.children);
                        if (found) return found;
                    }
                }
                return null;
            };

            const parent = findNode(tree.personal) || findNode(tree.organization);
            const visibility = parent?.visibility ?? VisibilityScope.PRIVATE;

            handleNewFolder(visibility, parentId);
        },
        [tree, handleNewFolder]
    );

    // Rename folder
    const handleRename = useCallback(
        async (folderId: string, newName: string) => {
            try {
                await dispatch(
                    updateFolder({
                        folderId,
                        name: newName,
                    })
                ).unwrap();
            } catch (err) {
                console.error('Failed to rename folder:', err);
            }
        },
        [dispatch]
    );

    // Delete folder
    const handleDelete = useCallback(
        async (folderId: string) => {
            try {
                await dispatch(
                    deleteFolder({
                        folderId,
                        recursive: true,
                    })
                ).unwrap();

                if (selectedFolderId === folderId) {
                    handleSelectFolder(null);
                }
                dispatch(fetchFilesTree({ includeFiles: false }));
            } catch (err) {
                console.error('Failed to delete folder:', err);
            }
        },
        [dispatch, selectedFolderId, handleSelectFolder]
    );

    // Refresh tree
    const handleRefresh = useCallback(() => {
        dispatch(fetchFilesTree({ includeFiles: false }));
        dispatch(initializeFilesData({ forceRefresh: true }));
    }, [dispatch]);

    // Handle scope filter change
    const handleScopeChange = useCallback((scope: 'all' | 'personal' | 'shared' | 'organization') => {
        dispatch(setViewScope(scope));
        navigate('/files'); // Clear folder param
    }, [dispatch, navigate]);

    // Handle upload button click
    const handleUploadClick = useCallback(() => {
        if (hasTransferActivity) {
            // When there's activity, toggle the status panel
            dispatch(toggleUploadPanel());
        } else {
            // When idle, trigger file upload
            onUpload?.();
        }
    }, [dispatch, hasTransferActivity, onUpload]);

    // Open bookmarked file in viewer
    const handleOpenBookmarkedFile = useCallback(
        (fileId: string) => {
            dispatch(openViewer({ fileId }));
        },
        [dispatch]
    );

    // Restore file from trash
    const handleRestoreFile = useCallback(
        async (fileId: string, e: React.MouseEvent) => {
            e.stopPropagation();
            try {
                setRestoringFileId(fileId);
                await dispatch(restoreFile(fileId)).unwrap();
                dispatch(fetchFilesTree({ includeFiles: false }));
            } catch (error) {
                console.error('Failed to restore file:', error);
            } finally {
                setRestoringFileId(null);
            }
        },
        [dispatch]
    );

    // Show empty trash confirmation modal
    const handleEmptyTrashClick = useCallback(() => {
        if (deletedFiles.length === 0 || !organizationId) return;
        setShowEmptyTrashConfirm(true);
    }, [deletedFiles.length, organizationId]);

    // Handle confirmed empty trash
    const handleEmptyTrashConfirm = useCallback(async () => {
        if (!organizationId) return;

        try {
            setEmptyingTrash(true);
            setEmptyTrashError(null);
            await filesApi.emptyTrash({ organizationId });

            // Force refresh both files and folder tree
            dispatch(initializeFilesData({ forceRefresh: true }));
            dispatch(fetchFilesTree({ includeFiles: false }));
            setShowEmptyTrashConfirm(false);
        } catch (error) {
            console.error('Failed to empty trash:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to empty trash';
            setEmptyTrashError(errorMessage);
        } finally {
            setEmptyingTrash(false);
        }
    }, [organizationId, dispatch]);

    // Render section
    const renderSection = (config: SectionConfig) => {
        const nodes = tree[config.id] || [];
        const sectionExpanded = isExpanded(config.id);
        const IconComponent = config.icon;
        const isBookmarksSection = config.id === 'bookmarked';

        return (
            <div key={config.id}>
                <button
                    onClick={() => handleToggle(config.id)}
                    className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group"
                >
                    {sectionExpanded ? (
                        <CaretDown size={16} weight="bold" className="text-muted-foreground" />
                    ) : (
                        <CaretRight size={16} weight="bold" className="text-muted-foreground" />
                    )}
                    <IconComponent size={16} weight={isBookmarksSection ? "fill" : "duotone"} className={isBookmarksSection ? "text-primary" : "text-muted-foreground"} />
                    <span className="flex-1">{config.name}</span>
                </button>

                {sectionExpanded && (
                    <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                        {isBookmarksSection ? (
                            // Render bookmarked files
                            <>
                                {nodes.map((node) => (
                                    <div
                                        key={node.id}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left cursor-pointer group"
                                        onClick={() => handleOpenBookmarkedFile(node.id)}
                                    >
                                        <File size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />
                                        <BookmarkSimple size={12} weight="fill" className="text-primary flex-shrink-0" />
                                        <span className="flex-1 truncate">{node.name}</span>
                                    </div>
                                ))}
                                {nodes.length === 0 && (
                                    <div className="ml-2 py-2 text-xs text-muted-foreground">
                                        No bookmarked files
                                    </div>
                                )}
                            </>
                        ) : (
                            // Render folder tree
                            <>
                                {nodes.map((node) => (
                                    <FolderNode
                                        key={node.id}
                                        node={node}
                                        isExpanded={isExpanded(node.id)}
                                        isSelected={selectedFolderId === node.id}
                                        onToggle={handleToggle}
                                        onSelect={handleSelectFolder}
                                        onRename={handleRename}
                                        onDelete={handleDelete}
                                        onCreateSubfolder={handleCreateSubfolder}
                                        editingId={editingId}
                                        onStartEdit={setEditingId}
                                        onCancelEdit={() => setEditingId(null)}
                                        isNodeExpanded={isExpanded}
                                    />
                                ))}
                                {nodes.length === 0 && (
                                    <div className="ml-2 py-2 text-xs text-muted-foreground">
                                        No folders
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // Render trash section
    const renderTrash = () => {
        if (deletedFiles.length === 0) return null;

        return (
            <div className="mt-2 pt-2 border-t border-border">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowTrash(!showTrash)}
                        className="flex-1 flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left"
                    >
                        {showTrash ? (
                            <CaretDown size={16} weight="bold" className="text-muted-foreground" />
                        ) : (
                            <CaretRight size={16} weight="bold" className="text-muted-foreground" />
                        )}
                        <Trash size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="flex-1">Trash</span>
                    </button>
                    <button
                        onClick={handleEmptyTrashClick}
                        disabled={emptyingTrash || deletedFiles.length === 0}
                        className="px-2 py-1.5 text-xs rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Empty trash"
                    >
                        {emptyingTrash ? 'Emptying...' : 'Empty'}
                    </button>
                </div>

                {showTrash && (
                    <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                        {deletedFiles.map((file) => (
                            <div
                                key={file.id}
                                className="group w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left opacity-60 cursor-default"
                            >
                                <File size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />
                                <span className="truncate flex-1">{file.filename}</span>
                                <button
                                    onClick={(e) => handleRestoreFile(file.id, e)}
                                    disabled={restoringFileId === file.id}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                    title="Restore"
                                >
                                    {restoringFileId === file.id ? (
                                        <ArrowsClockwise size={14} weight="bold" className="animate-spin" />
                                    ) : (
                                        <ArrowUUpLeft size={14} weight="bold" />
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
                {/* Upload/Status Button */}
                <button
                    onClick={handleUploadClick}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors",
                        showPanel && hasTransferActivity && "bg-muted"
                    )}
                    title={hasTransferActivity ? "View transfer status" : "Upload files"}
                >
                    {isDownloading && !isUploading ? (
                        <CloudArrowDown size={16} weight="bold" className={isDownloading ? "animate-pulse" : ""} />
                    ) : (
                        <CloudArrowUp size={16} weight="bold" className={isUploading ? "animate-pulse" : ""} />
                    )}
                    {hasTransferActivity ? (
                        <span className="tabular-nums">
                            {isUploading && `${activeUploadCount}↑`}
                            {isUploading && isDownloading && ' '}
                            {isDownloading && `${activeDownloadCount}↓`}
                        </span>
                    ) : (
                        <span>Upload</span>
                    )}
                </button>

                <div className="flex items-center gap-1">
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
                        title="Refresh"
                    >
                        <ArrowsClockwise
                            size={16}
                            weight="bold"
                            className={cn("text-muted-foreground", loading && "animate-spin")}
                        />
                    </button>
                    {onToggleSidebar && (
                        <button
                            onClick={onToggleSidebar}
                            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
                            title="Toggle sidebar"
                        >
                            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
                        </button>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <FilesSubmenu />

            {/* Error state */}
            {error && (
                <div className="px-3 py-2">
                    <div className="px-3 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md">
                        {error}
                        <button
                            onClick={handleRefresh}
                            className="ml-2 underline hover:no-underline"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}

            {/* Main Sections */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
                <nav className="space-y-0.5">
                    {/* Bookmarks */}
                    {renderSection(BOOKMARKS_SECTION)}

                    {/* Scope Filters */}
                    <div className="space-y-0.5 pt-2">
                        {SCOPE_FILTERS.map((filter) => {
                            const IconComponent = filter.icon;
                            const isActive = viewScope === filter.id;

                            return (
                                <button
                                    key={filter.id}
                                    onClick={() => handleScopeChange(filter.id)}
                                    className={cn(
                                        "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors text-left",
                                        isActive
                                            ? "bg-accent text-accent-foreground"
                                            : "hover:bg-accent"
                                    )}
                                >
                                    <IconComponent
                                        size={16}
                                        weight={isActive ? "fill" : "duotone"}
                                        className={isActive ? "text-primary" : "text-muted-foreground"}
                                    />
                                    <span className="flex-1">{filter.name}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Trash */}
                    {renderTrash()}
                </nav>
            </div>

            {/* Empty Trash Confirmation Modal */}
            {showEmptyTrashConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-background w-full max-w-md rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted/30">
                            <div className="rounded-lg bg-destructive/10 p-2">
                                <Trash size={20} weight="duotone" className="text-destructive" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Empty Trash</h2>
                                <p className="text-xs text-muted-foreground">This action cannot be undone</p>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Are you sure you want to permanently delete{' '}
                                <span className="font-medium text-foreground">{deletedFiles.length} file{deletedFiles.length !== 1 ? 's' : ''}</span>{' '}
                                from the trash? This will free up space but the files cannot be recovered.
                            </p>
                            {emptyTrashError && (
                                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30">
                                    <p className="text-sm text-destructive">{emptyTrashError}</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
                            <Button
                                variant="outline"
                                size="md"
                                onClick={() => {
                                    setShowEmptyTrashConfirm(false);
                                    setEmptyTrashError(null);
                                }}
                                disabled={emptyingTrash}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                size="md"
                                onClick={handleEmptyTrashConfirm}
                                disabled={emptyingTrash}
                            >
                                {emptyingTrash ? 'Deleting...' : 'Delete Permanently'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
