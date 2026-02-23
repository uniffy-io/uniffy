/**
 * Notes Sidebar Component
 *
 * Orchestrates the notes tree sidebar. Manages Redux state, callbacks,
 * and delegates rendering to sub-components.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTreeStateSync } from '@/features/notes/hooks/useTreeStateSync';
import {
    BookmarkSimple as BookmarkSimpleIcon,
    CaretDown,
    CaretRight,
    CaretUp,
    LockSimple,
    UsersThree,
    Buildings,
    ArrowsClockwise,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setCurrentNote,
    createNote,
    fetchNote,
    deleteNote,
    updateNote,
    initializeNotesData,
    moveNote,
    copyNote,
} from '@/features/notes/store/notesSlice';
import {
    toggleNodeExpanded,
    expandNode,
    updateNodeTitle,
    expandAll,
    collapseAll,
    setBookmarkedNodes,
    setSelectedNode,
} from '@/features/notes/store/notesTreeSlice';
import type { TreeNode } from '@/features/notes/store/notesTreeSlice';
import { VisibilityScope, NodeType } from '@/gen/notes/v1/notes_pb';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useBookmarks } from '@/features/bookmarks';
import { cn } from '@/shared/utils/cn';
import { SidebarHeader } from '@/features/notes/components/sidebar/SidebarHeader';
import { TreeNodeItem } from '@/features/notes/components/sidebar/TreeNodeItem';
import { TreeNodeContextMenu } from '@/features/notes/components/sidebar/TreeNodeContextMenu';
import { TrashSection } from '@/features/notes/components/sidebar/TrashSection';
import { NoteMoveDialog } from '@/features/notes/components/sidebar/NoteMoveDialog';
import { CreateDropdown } from '@/features/notes/components/sidebar/CreateDropdown';
import type { ActiveMenuState, MoveTarget } from '@/features/notes/components/sidebar/types';

// Section configuration
interface SectionConfig {
    id: 'bookmarked' | 'personal' | 'shared' | 'organization' | 'trash';
    name: string;
    icon: typeof LockSimple;
    scope?: VisibilityScope;
}

const SECTIONS: SectionConfig[] = [
    { id: 'bookmarked', name: 'Bookmarks', icon: BookmarkSimpleIcon },
    { id: 'personal', name: 'Personal Space', icon: LockSimple, scope: VisibilityScope.PRIVATE },
    { id: 'shared', name: 'Shared With Me', icon: UsersThree },
    { id: 'organization', name: 'Organization', icon: Buildings, scope: VisibilityScope.ORGANIZATION },
];

/**
 * Main sidebar component.
 */
export function NotesSidebar() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();

    // Redux state
    const currentNoteId = useAppSelector((state) => state.notes.currentNoteId);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const tree = useAppSelector((state) => state.notesTree.tree);
    const expandedNodes = useAppSelector((state) => state.notesTree.expandedNodes);
    const selectedNodeId = useAppSelector((state) => state.notesTree.selectedNodeId);
    const loading = useAppSelector((state) => state.notesTree.loading);
    const creatingNote = useAppSelector((state) => state.notes.creatingNote);

    // Bookmarks state
    useBookmarks();
    const bookmarkedUrns = useAppSelector((state) => state.bookmarks.bookmarkedUrns);

    // Sync tree expanded state with localStorage
    useTreeStateSync();

    // Populate bookmarked section from bookmarks store
    useEffect(() => {
        const bookmarkedNoteIds = Object.keys(bookmarkedUrns)
            .filter(urn => bookmarkedUrns[urn] && urn.includes(':NOTE:'))
            .map(urn => urn.split(':NOTE:')[1]);

        const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
            for (const node of nodes) {
                if (node.id === id) return node;
                if (node.children) {
                    const found = findNodeById(node.children, id);
                    if (found) return found;
                }
            }
            return null;
        };

        const allTreeNodes = [
            ...tree.personal,
            ...tree.shared,
            ...tree.organization,
            ...tree.groups.flatMap(g => g.nodes),
        ];

        const bookmarkedNodes: TreeNode[] = bookmarkedNoteIds
            .map(noteId => findNodeById(allTreeNodes, noteId))
            .filter((node): node is TreeNode => node !== null);

        dispatch(setBookmarkedNodes(bookmarkedNodes));
    }, [bookmarkedUrns, tree.personal, tree.shared, tree.organization, tree.groups, dispatch]);

    // Local UI state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [sectionDropTarget, setSectionDropTarget] = useState<string | null>(null);
    const [activeMenu, setActiveMenu] = useState<ActiveMenuState | null>(null);
    const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
    const [pendingOrgMove, setPendingOrgMove] = useState<{
        noteId: string;
        targetVisibility: VisibilityScope;
        targetFolderId: string | null;
    } | null>(null);

    // --- Helpers ---

    const isExpanded = useCallback(
        (id: string) => expandedNodes.includes(id),
        [expandedNodes]
    );

    const findNodeRecursively = useCallback(
        (nodes: TreeNode[], nodeId: string): TreeNode | null => {
            for (const node of nodes) {
                if (node.id === nodeId) return node;
                if (node.children) {
                    const found = findNodeRecursively(node.children, nodeId);
                    if (found) return found;
                }
            }
            return null;
        },
        []
    );

    const findNodeVisibility = useCallback(
        (nodeId: string): VisibilityScope => {
            if (findNodeRecursively(tree.personal, nodeId)) return VisibilityScope.PRIVATE;
            if (findNodeRecursively(tree.organization, nodeId)) return VisibilityScope.ORGANIZATION;
            if (findNodeRecursively(tree.shared, nodeId)) return VisibilityScope.PRIVATE;

            for (const group of tree.groups) {
                if (findNodeRecursively(group.nodes, nodeId)) return VisibilityScope.GROUP;
            }

            const inBookmarked = findNodeRecursively(tree.bookmarked, nodeId);
            if (inBookmarked) return inBookmarked.visibility || VisibilityScope.PRIVATE;

            return VisibilityScope.PRIVATE;
        },
        [tree, findNodeRecursively]
    );

    const findNodeParentId = useCallback(
        (nodes: TreeNode[], nodeId: string, parentId: string | null = null): string | null => {
            for (const node of nodes) {
                if (node.id === nodeId) return parentId;
                if (node.children) {
                    const found = findNodeParentId(node.children, nodeId, node.id);
                    if (found !== undefined) return found;
                }
            }
            return null;
        },
        []
    );

    // --- Handlers ---

    const handleToggle = useCallback(
        (id: string) => { dispatch(toggleNodeExpanded(id)); },
        [dispatch]
    );

    const handleSelectNote = useCallback(
        async (noteId: string) => {
            dispatch(setSelectedNode(null));
            navigate(`/notes/${noteId}`);
            try {
                await dispatch(fetchNote(noteId)).unwrap();
            } catch (err) {
                console.error('Failed to fetch note:', err);
                dispatch(setCurrentNote(null));
            }
        },
        [dispatch, navigate]
    );

    const handleNewNote = useCallback(
        async (visibility: VisibilityScope = VisibilityScope.PRIVATE) => {
            try {
                const result = await dispatch(
                    createNote({
                        title: 'Untitled Note',
                        content: '# Untitled Note\n\nStart writing here...',
                        visibility,
                        nodeType: NodeType.NOTE,
                    })
                ).unwrap();
                navigate(`/notes/${result.id}`);
                setEditingId(result.id);
            } catch (err) {
                console.error('Failed to create note:', err);
            }
        },
        [dispatch, navigate]
    );

    const handleNewCanvas = useCallback(
        async (visibility: VisibilityScope = VisibilityScope.PRIVATE) => {
            try {
                const { createEmptyCanvas, serializeCanvas } = await import('@/features/notes/canvas/types');
                const result = await dispatch(
                    createNote({
                        title: 'Untitled Canvas',
                        content: serializeCanvas(createEmptyCanvas()),
                        visibility,
                        nodeType: NodeType.CANVAS,
                    })
                ).unwrap();
                navigate(`/notes/${result.id}`);
                setEditingId(result.id);
            } catch (err) {
                console.error('Failed to create canvas:', err);
            }
        },
        [dispatch, navigate]
    );

    const handleNewFolder = useCallback(
        async (visibility: VisibilityScope = VisibilityScope.PRIVATE, parentId?: string) => {
            try {
                const result = await dispatch(
                    createNote({
                        title: 'New Folder',
                        content: '',
                        visibility,
                        nodeType: NodeType.FOLDER,
                        parentId,
                    })
                ).unwrap();
                setEditingId(result.id);
            } catch (err) {
                console.error('Failed to create folder:', err);
            }
        },
        [dispatch]
    );

    const handleCreateSubfolder = useCallback(
        async (parentId: string) => {
            dispatch(expandNode(parentId));
            const visibility = findNodeVisibility(parentId);
            await handleNewFolder(visibility, parentId);
        },
        [dispatch, findNodeVisibility, handleNewFolder]
    );

    const handleCreateNoteInFolder = useCallback(
        async (parentId: string) => {
            dispatch(expandNode(parentId));
            const visibility = findNodeVisibility(parentId);
            try {
                const result = await dispatch(
                    createNote({
                        title: 'Untitled Note',
                        content: '# Untitled Note\n\nStart writing here...',
                        visibility,
                        nodeType: NodeType.NOTE,
                        parentId,
                    })
                ).unwrap();
                navigate(`/notes/${result.id}`);
                setEditingId(result.id);
            } catch (err) {
                console.error('Failed to create note:', err);
            }
        },
        [dispatch, findNodeVisibility, navigate]
    );

    const handleCreateCanvasInFolder = useCallback(
        async (parentId: string) => {
            dispatch(expandNode(parentId));
            const visibility = findNodeVisibility(parentId);
            try {
                const { createEmptyCanvas, serializeCanvas } = await import('@/features/notes/canvas/types');
                const result = await dispatch(
                    createNote({
                        title: 'Untitled Canvas',
                        content: serializeCanvas(createEmptyCanvas()),
                        visibility,
                        nodeType: NodeType.CANVAS,
                        parentId,
                    })
                ).unwrap();
                navigate(`/notes/${result.id}`);
                setEditingId(result.id);
            } catch (err) {
                console.error('Failed to create canvas:', err);
            }
        },
        [dispatch, findNodeVisibility, navigate]
    );

    const handleRename = useCallback(
        async (nodeId: string, newTitle: string) => {
            if (!organizationId) return;
            dispatch(updateNodeTitle({ nodeId, title: newTitle }));
            try {
                await dispatch(updateNote({ noteId: nodeId, title: newTitle })).unwrap();
            } catch (err) {
                console.error('Failed to rename note/folder:', err);
                dispatch(initializeNotesData({ forceRefresh: true }));
            }
        },
        [dispatch, organizationId]
    );

    const handleDelete = useCallback(
        async (noteId: string) => {
            try {
                await dispatch(deleteNote({ noteId })).unwrap();
                if (currentNoteId === noteId) {
                    dispatch(setCurrentNote(null));
                }
            } catch (err) {
                console.error('Failed to delete item:', err);
            }
        },
        [dispatch, currentNoteId]
    );

    const handleCopy = useCallback(
        async (noteId: string) => {
            const visibility = findNodeVisibility(noteId);
            const allNodes = [
                ...tree.personal, ...tree.shared, ...tree.organization,
                ...tree.groups.flatMap(g => g.nodes), ...tree.bookmarked,
            ];
            const node = findNodeRecursively(allNodes, noteId);
            const title = node ? `Copy of ${node.title}` : 'Copy';

            try {
                const result = await dispatch(copyNote({
                    noteId,
                    targetVisibility: visibility,
                    title,
                })).unwrap();
                dispatch(initializeNotesData({ forceRefresh: true }));
                navigate(`/notes/${result.id}`);
            } catch (err) {
                console.error('Failed to copy note:', err);
            }
        },
        [findNodeVisibility, findNodeRecursively, tree, dispatch, navigate]
    );

    const handleOpenMoveDialog = useCallback(
        (nodeId: string) => {
            const visibility = findNodeVisibility(nodeId);
            const allNodes = [
                ...tree.personal, ...tree.shared, ...tree.organization,
                ...tree.groups.flatMap(g => g.nodes), ...tree.bookmarked,
            ];
            const node = findNodeRecursively(allNodes, nodeId);
            const parentId = findNodeParentId(
                [...tree.personal, ...tree.organization],
                nodeId
            );

            setMoveTarget({
                noteId: nodeId,
                noteTitle: node?.title ?? 'Note',
                currentVisibility: visibility,
                currentParentId: parentId,
            });
        },
        [findNodeVisibility, findNodeRecursively, findNodeParentId, tree]
    );

    // --- Drag & Drop ---

    const handleDrop = useCallback(
        async (targetFolderId: string, droppedNodeId: string) => {
            if (!organizationId) return;

            const droppedNodeVisibility = findNodeVisibility(droppedNodeId);
            const targetFolderVisibility = findNodeVisibility(targetFolderId);

            if (targetFolderVisibility === VisibilityScope.ORGANIZATION &&
                droppedNodeVisibility !== VisibilityScope.ORGANIZATION) {
                setPendingOrgMove({ noteId: droppedNodeId, targetVisibility: targetFolderVisibility, targetFolderId });
                return;
            }

            try {
                if (droppedNodeVisibility !== targetFolderVisibility) {
                    await dispatch(moveNote({ noteId: droppedNodeId, targetVisibility: targetFolderVisibility })).unwrap();
                }
                await dispatch(updateNote({ noteId: droppedNodeId, parentId: targetFolderId })).unwrap();
                dispatch(initializeNotesData({ forceRefresh: true }));
            } catch (err) {
                console.error('Failed to move note:', err);
                dispatch(initializeNotesData({ forceRefresh: true }));
            }
        },
        [dispatch, organizationId, findNodeVisibility]
    );

    const handleDropOnSection = useCallback(
        async (targetVisibility: VisibilityScope, droppedNodeId: string) => {
            if (!organizationId) return;

            const droppedNodeVisibility = findNodeVisibility(droppedNodeId);

            if (targetVisibility === VisibilityScope.ORGANIZATION &&
                droppedNodeVisibility !== VisibilityScope.ORGANIZATION) {
                setPendingOrgMove({ noteId: droppedNodeId, targetVisibility, targetFolderId: null });
                return;
            }

            try {
                if (droppedNodeVisibility !== targetVisibility) {
                    await dispatch(moveNote({ noteId: droppedNodeId, targetVisibility })).unwrap();
                }
                await dispatch(updateNote({ noteId: droppedNodeId, parentId: '' })).unwrap();
                dispatch(initializeNotesData({ forceRefresh: true }));
            } catch (err) {
                console.error('Failed to move note to section:', err);
                dispatch(initializeNotesData({ forceRefresh: true }));
            }
        },
        [dispatch, organizationId, findNodeVisibility]
    );

    const handleOrgMoveConfirm = useCallback(async () => {
        if (!pendingOrgMove || !organizationId) return;
        const { noteId, targetVisibility, targetFolderId } = pendingOrgMove;

        try {
            await dispatch(moveNote({ noteId, targetVisibility })).unwrap();
            await dispatch(updateNote({ noteId, parentId: targetFolderId ?? '' })).unwrap();
            dispatch(initializeNotesData({ forceRefresh: true }));
        } catch (err) {
            console.error('Failed to move note:', err);
            dispatch(initializeNotesData({ forceRefresh: true }));
        } finally {
            setPendingOrgMove(null);
        }
    }, [pendingOrgMove, organizationId, dispatch]);

    // --- Menu ---

    const handleOpenMenu = useCallback(
        (nodeId: string, nodeType: 'note' | 'folder' | 'canvas', position: { x: number; y: number }) => {
            setActiveMenu({ nodeId, nodeType, position });
        },
        []
    );

    const handleCloseMenu = useCallback(() => {
        setActiveMenu(null);
    }, []);

    const handleMenuRename = useCallback((nodeId: string) => {
        setEditingId(nodeId);
    }, []);

    const handleMenuMove = useCallback((nodeId: string) => {
        handleOpenMoveDialog(nodeId);
    }, [handleOpenMoveDialog]);

    // --- Memoized grouped props for TreeNodeItem ---

    const treeActions = useMemo(() => ({
        onToggle: handleToggle,
        onSelect: handleSelectNote,
        onRename: handleRename,
        onDelete: handleDelete,
    }), [handleToggle, handleSelectNote, handleRename, handleDelete]);

    const treeDrag = useMemo(() => ({
        draggedNodeId,
        onDrop: handleDrop,
        onDragStart: (nodeId: string) => setDraggedNodeId(nodeId),
        onDragEnd: () => setDraggedNodeId(null),
    }), [draggedNodeId, handleDrop]);

    const treeEditing = useMemo(() => ({
        editingId,
        onStartEdit: setEditingId,
        onCancelEdit: () => setEditingId(null),
    }), [editingId]);

    const isNodeSelected = useCallback(
        (nodeId: string) => currentNoteId === nodeId || selectedNodeId === nodeId,
        [currentNoteId, selectedNodeId]
    );

    const handleRefresh = useCallback(() => {
        dispatch(initializeNotesData({ forceRefresh: true }));
    }, [dispatch]);

    // --- Section Renderers ---

    const renderSection = (config: SectionConfig) => {
        const nodes = tree[config.id];
        const sectionExpanded = isExpanded(config.id);
        const SectionIcon = config.icon;
        const canDropOnSection = config.scope && draggedNodeId;
        const isDropTarget = sectionDropTarget === config.id;

        return (
            <div key={config.id}>
                <div
                    onClick={() => handleToggle(config.id)}
                    onDragOver={(e) => {
                        if (canDropOnSection) {
                            e.preventDefault();
                            setSectionDropTarget(config.id);
                        }
                    }}
                    onDragLeave={() => setSectionDropTarget(null)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setSectionDropTarget(null);
                        if (canDropOnSection && draggedNodeId && config.scope) {
                            handleDropOnSection(config.scope, draggedNodeId);
                        }
                    }}
                    className={cn(
                        "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer",
                        isDropTarget && "bg-primary/10 ring-2 ring-primary"
                    )}
                >
                    {sectionExpanded ? (
                        <CaretDown size={16} weight="bold" className="text-muted-foreground" />
                    ) : (
                        <CaretRight size={16} weight="bold" className="text-muted-foreground" />
                    )}
                    <SectionIcon size={16} weight="duotone" className={config.id === 'bookmarked' ? 'text-primary' : 'text-muted-foreground'} />
                    <span className="flex-1">{config.name}</span>
                    {config.scope && (
                        <span className="opacity-0 group-hover:opacity-100 transition-all shrink-0 flex items-center">
                            <CreateDropdown
                                compact
                                onCreateNote={() => handleNewNote(config.scope)}
                                onCreateCanvas={() => handleNewCanvas(config.scope)}
                                onCreateFolder={() => handleNewFolder(config.scope)}
                            />
                        </span>
                    )}
                </div>

                {sectionExpanded && nodes.length > 0 && (
                    <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                        {nodes.map((node) => (
                            <TreeNodeItem
                                key={node.id}
                                node={node}
                                isExpanded={isExpanded(node.id)}
                                isSelected={currentNoteId === node.id}
                                actions={treeActions}
                                drag={treeDrag}
                                editing={treeEditing}
                                isNodeExpanded={isExpanded}
                                isNodeSelected={isNodeSelected}
                                onOpenMenu={handleOpenMenu}
                                onCreateNote={handleCreateNoteInFolder}
                                onCreateCanvas={handleCreateCanvasInFolder}
                                onCreateFolder={handleCreateSubfolder}
                            />
                        ))}
                    </div>
                )}

                {sectionExpanded && nodes.length === 0 && (
                    <div className="ml-8 py-2 text-xs text-muted-foreground">
                        No notes yet
                    </div>
                )}
            </div>
        );
    };

    const renderGroups = () => {
        if (tree.groups.length === 0) return null;

        return (
            <div className="mt-2 pt-2 border-t border-border">
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Groups
                </p>
                {tree.groups.map((group) => {
                    const groupExpanded = isExpanded(`group-${group.groupId}`);

                    return (
                        <div key={group.groupId}>
                            <button
                                onClick={() => handleToggle(`group-${group.groupId}`)}
                                className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group"
                            >
                                {groupExpanded ? (
                                    <CaretDown size={16} weight="bold" className="text-muted-foreground" />
                                ) : (
                                    <CaretRight size={16} weight="bold" className="text-muted-foreground" />
                                )}
                                <UsersThree size={16} weight="duotone" className="text-muted-foreground" />
                                <span className="flex-1">{group.groupName}</span>
                            </button>

                            {groupExpanded && group.nodes.length > 0 && (
                                <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                                    {group.nodes.map((node) => (
                                        <TreeNodeItem
                                            key={node.id}
                                            node={node}
                                            isExpanded={isExpanded(node.id)}
                                            isSelected={currentNoteId === node.id}
                                            actions={treeActions}
                                            drag={treeDrag}
                                            editing={treeEditing}
                                            isNodeExpanded={isExpanded}
                                            isNodeSelected={isNodeSelected}
                                            onOpenMenu={handleOpenMenu}
                                            onCreateNote={handleCreateNoteInFolder}
                                            onCreateCanvas={handleCreateCanvasInFolder}
                                            onCreateFolder={handleCreateSubfolder}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <SidebarHeader
                onCreateNote={() => handleNewNote()}
                onCreateCanvas={() => handleNewCanvas()}
                onCreateFolder={() => handleNewFolder()}
                creatingNote={creatingNote}
            />

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
                            <ArrowsClockwise size={14} weight="bold" className={`text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                    {SECTIONS.map(renderSection)}
                    {renderGroups()}
                    <TrashSection
                        trashNodes={tree.trash}
                        currentNoteId={currentNoteId}
                        organizationId={organizationId}
                        onSelectNote={handleSelectNote}
                    />
                </nav>
            </div>

            {/* Organization Move Confirmation (drag & drop) */}
            <ConfirmDialog
                isOpen={pendingOrgMove !== null}
                onClose={() => setPendingOrgMove(null)}
                onConfirm={handleOrgMoveConfirm}
                title="Move to Organization"
                message="Moving this note to Organization will make it visible to all organization members. Any content referenced within (attached files, mentioned notes, inline media) will also become visible to the organization."
                confirmLabel="Move to Organization"
                cancelLabel="Cancel"
                variant="warning"
            />

            {/* Three-dot context menu */}
            {activeMenu && (
                <TreeNodeContextMenu
                    menu={activeMenu}
                    onClose={handleCloseMenu}
                    onRename={handleMenuRename}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onMove={handleMenuMove}
                />
            )}

            {/* Move dialog */}
            {moveTarget && (
                <NoteMoveDialog
                    target={moveTarget}
                    onClose={() => setMoveTarget(null)}
                />
            )}
        </div>
    );
}
