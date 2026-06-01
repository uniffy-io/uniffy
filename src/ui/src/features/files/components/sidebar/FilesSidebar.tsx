import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
    CaretDown,
    CaretRight,
    CaretUp,
    CaretDoubleLeft,
    Folder,
    FolderOpen,
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
    Funnel,
    Tag,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useBookmarks } from '@/features/bookmarks';
import { cn } from '@/shared/utils/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import {
    toggleNodeExpanded,
    setSelectedFolder,
    setBookmarkedNodes,
    fetchFilesTree,
    createFolder,
    updateFolder,
    deleteFolder,
    expandAll,
    collapseAll,
} from '@/features/files/store/filesTreeSlice';
import { setFolderId, setViewScope, initializeFilesData } from '@/features/files/store/filesSlice';
import { openViewer } from '@/features/files/store/viewerSlice';
import { StorageUsageIndicator } from '@/features/admin/components/storage/StorageUsageIndicator';
import { setTrayView } from '@/features/files/store/uploadSlice';
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
    { name: 'Tags', path: '/tags?domain=file', icon: Tag },
    { name: 'Filters', path: '/files/filters', icon: Funnel },
];

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

    const [editValue, setEditValue] = useState(node.name);

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
    onUploadFolder?: () => void;
}

export function FilesSidebar({ onToggleSidebar, onUpload, onUploadFolder }: FilesSidebarProps) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { isMobile } = useBreakpoint();

    const tree = useAppSelector((state) => state.filesTree.tree);
    const expandedNodes = useAppSelector((state) => state.filesTree.expandedNodes);
    const selectedFolderId = useAppSelector((state) => state.filesTree.selectedFolderId);
    const loading = useAppSelector((state) => state.filesTree.loading);

    const viewScope = useAppSelector((state) => state.files.filters.viewScope);

    // Local state
    const [editingId, setEditingId] = useState<string | null>(null);

    // Bookmarks state
    useBookmarks(); // Auto-fetches bookmarks on organization change
    const bookmarkedUrns = useAppSelector((state) => state.bookmarks.bookmarkedUrns);
    const files = useAppSelector((state) => state.files.files);

    // Upload/Download status
    const activeUploadCount = useAppSelector((state) =>
        state.upload.records.filter(
            (r) => r.status === 'uploading' || r.status === 'completing' || r.status === 'queued'
        ).length
    );
    const isUploading = activeUploadCount > 0;
    const isDownloading = useAppSelector((state) => state.upload.isDownloading);
    const showPanel = useAppSelector((state) => state.upload.trayView === 'expanded');
    const activeDownloadCount = useAppSelector((state) =>
        Object.keys(state.upload.activeDownloads).length
    );
    const hasTransferActivity = isUploading || isDownloading;

    // Populate bookmarked section from bookmarks store
    useEffect(() => {
        const bookmarkedFileIds = Object.keys(bookmarkedUrns)
            .filter(urn => bookmarkedUrns[urn] && urn.includes(':FILE:'))
            .map(urn => urn.split(':FILE:')[1]);

        const bookmarkedNodes: SerializedTreeNode[] = bookmarkedFileIds
            .map(fileId => {
                const file = files[fileId];
                if (!file) return null;
                return {
                    id: file.id,
                    name: file.filename,
                    isFolder: false,
                    parentId: file.folderId,
                    accessMode: file.accessMode,
                    childCount: 0,
                    children: [],
                } as SerializedTreeNode;
            })
            .filter((node): node is SerializedTreeNode => node !== null);

        dispatch(setBookmarkedNodes(bookmarkedNodes));
    }, [bookmarkedUrns, files, dispatch]);

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

    const handleNewFolder = useCallback(
        async (parentId?: string) => {
            try {
                const result = await dispatch(
                    createFolder({
                        name: 'New Folder',
                        parentId,
                    })
                ).unwrap();

                // Start editing the name
                setEditingId(result.id);

                // Expand parent if creating subfolder
                if (parentId && !expandedNodes.includes(parentId)) {
                    dispatch(toggleNodeExpanded(parentId));
                }
            } catch {
            }
        },
        [dispatch, expandedNodes]
    );

    const handleCreateSubfolder = useCallback(
        (parentId: string) => {
            handleNewFolder(parentId);
        },
        [handleNewFolder]
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
            } catch {
            }
        },
        [dispatch]
    );

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
            } catch {
            }
        },
        [dispatch, selectedFolderId, handleSelectFolder]
    );

    // Refresh tree
    const handleRefresh = useCallback(() => {
        dispatch(fetchFilesTree({ includeFiles: false }));
        dispatch(initializeFilesData({ forceRefresh: true }));
    }, [dispatch]);

    const handleScopeChange = useCallback((scope: 'all' | 'personal' | 'shared' | 'organization') => {
        dispatch(setViewScope(scope));
        navigate('/files'); // Clear folder param
    }, [dispatch, navigate]);

    // Upload menu popover (shown when idle so user can pick files vs folder)
    const uploadButtonRef = useRef<HTMLButtonElement>(null);
    const uploadMenuRef = useRef<HTMLDivElement>(null);
    const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
    const [uploadMenuPos, setUploadMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    useEffect(() => {
        if (!uploadMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node) &&
                uploadButtonRef.current && !uploadButtonRef.current.contains(e.target as Node)
            ) {
                setUploadMenuOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setUploadMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [uploadMenuOpen]);

    const handleUploadClick = useCallback(() => {
        if (hasTransferActivity) {
            // When there's activity, expand the transfers tray (or collapse it if already open).
            dispatch(setTrayView(showPanel ? 'minimized' : 'expanded'));
            return;
        }
        // When idle, open a small menu so the user can pick files or a folder
        const rect = uploadButtonRef.current?.getBoundingClientRect();
        if (rect) {
            const menuWidth = 180;
            const menuHeight = 90;
            const x = rect.left + menuWidth > window.innerWidth ? rect.right - menuWidth : rect.left;
            const y = rect.bottom + menuHeight > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
            setUploadMenuPos({ x, y });
        }
        setUploadMenuOpen((prev) => !prev);
    }, [dispatch, hasTransferActivity, showPanel]);

    const handleSelectUploadFiles = useCallback(() => {
        setUploadMenuOpen(false);
        onUpload?.();
    }, [onUpload]);

    const handleSelectUploadFolder = useCallback(() => {
        setUploadMenuOpen(false);
        onUploadFolder?.();
    }, [onUploadFolder]);

    // Open bookmarked file in viewer
    const handleOpenBookmarkedFile = useCallback(
        (fileId: string) => {
            dispatch(openViewer({ fileId }));
        },
        [dispatch]
    );

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

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
                {/* Upload/Status Button */}
                <button
                    ref={uploadButtonRef}
                    onClick={handleUploadClick}
                    className={cn(
                        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden hover:px-2.5",
                        showPanel && hasTransferActivity && "bg-muted",
                        uploadMenuOpen && "bg-muted"
                    )}
                    title={hasTransferActivity ? "View transfer status" : "Upload"}
                >
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
                    <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out text-muted-foreground group-hover:text-primary">
                        {isDownloading && !isUploading ? (
                            <CloudArrowDown size={18} weight="bold" className={isDownloading ? "animate-pulse" : ""} />
                        ) : (
                            <CloudArrowUp size={18} weight="bold" className={isUploading ? "animate-pulse" : ""} />
                        )}
                    </span>
                    <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
                        {hasTransferActivity ? (
                            <span className="tabular-nums">
                                {isUploading && `${activeUploadCount}↑`}
                                {isUploading && isDownloading && ' '}
                                {isDownloading && `${activeDownloadCount}↓`}
                            </span>
                        ) : (
                            'Upload'
                        )}
                    </span>
                </button>
                {uploadMenuOpen && (
                    <div
                        ref={uploadMenuRef}
                        className="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
                        style={{ top: uploadMenuPos.y, left: uploadMenuPos.x }}
                    >
                        <div className="py-1">
                            <button
                                onClick={handleSelectUploadFiles}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                            >
                                <File size={16} weight="duotone" className="text-primary" />
                                Upload Files
                            </button>
                            {onUploadFolder && (
                                <button
                                    onClick={handleSelectUploadFolder}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                                >
                                    <FolderOpen size={16} weight="duotone" className="text-primary" />
                                    Upload Folder
                                </button>
                            )}
                        </div>
                    </div>
                )}
                {filesNavItems.map((item) => {
                    const isActive = item.path === '/files'
                        ? location.pathname === '/files' && !location.search.includes('folder=')
                        : location.pathname === item.path;
                    return (
                        <CompactNavItem key={item.path} item={item} isActive={isActive} />
                    );
                })}
                <div className="flex-1" />
                {/* Hide collapse button on mobile (drawer has its own close) */}
                {onToggleSidebar && !isMobile && (
                    <button
                        onClick={onToggleSidebar}
                        className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors flex-shrink-0"
                        title="Toggle sidebar"
                    >
                        <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
                    </button>
                )}
            </div>

            {/* Main Sections */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
                <nav className="space-y-0.5">
                    {/* Tree controls */}
                    <div className="flex items-center gap-0.5 mb-1">
                        <button
                            onClick={() => dispatch(expandAll())}
                            className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors"
                            title="Expand all"
                        >
                            <CaretDown size={14} weight="bold" className="text-muted-foreground" />
                        </button>
                        <button
                            onClick={() => dispatch(collapseAll())}
                            className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors"
                            title="Collapse all"
                        >
                            <CaretUp size={14} weight="bold" className="text-muted-foreground" />
                        </button>
                        <button
                            onClick={handleRefresh}
                            disabled={loading}
                            className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
                            title="Refresh"
                        >
                            <ArrowsClockwise size={14} weight="bold" className={cn("text-muted-foreground", loading && "animate-spin")} />
                        </button>
                    </div>

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
                    <div className="mt-2 pt-2 border-t border-border">
                        <Link
                            to="/files/trash"
                            className={cn(
                                "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors text-left",
                                location.pathname === '/files/trash'
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-accent"
                            )}
                        >
                            <Trash
                                size={16}
                                weight={location.pathname === '/files/trash' ? "fill" : "duotone"}
                                className={location.pathname === '/files/trash' ? "text-primary" : "text-muted-foreground"}
                            />
                            <span className="flex-1">Trash</span>
                        </Link>
                    </div>

                </nav>
            </div>

            {/* Storage Usage */}
            <div className="px-1 pb-2 pt-1 border-t border-border mt-auto">
                <StorageUsageIndicator />
            </div>
        </div>
    );
}
