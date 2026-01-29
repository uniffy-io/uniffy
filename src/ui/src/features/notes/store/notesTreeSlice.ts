import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';
import { notesApi } from '../api/notesApi';
import { organizeNotesByVisibility } from '../utils/notesTreeUtils';
import type { RootState } from '@/app/store';
import type { Note } from '@/gen/notes/v1/notes_pb';
import { updateNote, updateNoteIcon, initializeNotesData, createNote, deleteNote, restoreNote } from './notesThunks';
import type { NoteIcon } from '../utils/noteIconConstants';

// Helper to convert proto Note to PlainMessage
const noteToPlain = (note: Note) => ({
    id: note.id,
    organizationId: note.organizationId,
    ownerId: note.ownerId,
    visibility: note.visibility,
    nodeType: note.nodeType,
    title: note.title,
    content: note.content,
    slug: note.slug,
    isDeleted: note.isDeleted,
    version: typeof note.version === 'bigint' ? Number(note.version) : note.version,
    parentId: note.parentId,
    tags: [...note.tags],
    inlineTags: [...note.inlineTags],
    metadata: { ...note.metadata },
    createdAt: note.createdAt ? {
        seconds: typeof note.createdAt.seconds === 'bigint' ? Number(note.createdAt.seconds) : note.createdAt.seconds,
        nanos: typeof note.createdAt.nanos === 'bigint' ? Number(note.createdAt.nanos) : note.createdAt.nanos
    } : undefined,
    updatedAt: note.updatedAt ? {
        seconds: typeof note.updatedAt.seconds === 'bigint' ? Number(note.updatedAt.seconds) : note.updatedAt.seconds,
        nanos: typeof note.updatedAt.nanos === 'bigint' ? Number(note.updatedAt.nanos) : note.updatedAt.nanos
    } : undefined,
    deletedAt: note.deletedAt ? {
        seconds: typeof note.deletedAt.seconds === 'bigint' ? Number(note.deletedAt.seconds) : note.deletedAt.seconds,
        nanos: typeof note.deletedAt.nanos === 'bigint' ? Number(note.deletedAt.nanos) : note.deletedAt.nanos
    } : undefined,
    groupIds: [...note.groupIds],
    userPermission: note.userPermission,
    outgoingReferences: [...note.outgoingReferences],
    // Custom icon (Phosphor icon name or emoji)
    icon: note.icon ? {
        type: note.icon.iconType as 'icon' | 'emoji',
        value: note.icon.value,
    } : undefined,
    // Owner info for notes shared with current user
    ownerInfo: note.ownerInfo ? {
        id: note.ownerInfo.id,
        name: note.ownerInfo.name,
        email: note.ownerInfo.email,
    } : undefined,
    // Users/groups this note is shared with (only for owner)
    sharedWith: note.sharedWith.length > 0 ? note.sharedWith.map(target => ({
        id: target.id,
        type: target.type as 'user' | 'group',
        name: target.name,
        email: target.email || undefined,
        memberCount: target.memberCount || undefined,
        permissionLevel: target.permissionLevel,
    })) : undefined,
});

export interface TreeNode {
    id: string;
    title: string;
    type: 'note' | 'folder';
    icon?: NoteIcon;
    children?: TreeNode[];
    noteId?: string;
    folderId?: string;
    isExpanded?: boolean;
    visibility?: VisibilityScope;
    updatedAt?: string;
    // Owner info for notes shared with current user
    ownerInfo?: {
        id: string;
        name: string;
        email: string;
    };
    // Whether this note is shared with others (for owned notes)
    isShared?: boolean;
}

export interface GroupTreeSection {
    groupId: string;
    groupName: string;
    nodes: TreeNode[];
    isExpanded: boolean;
}

interface NotesTreeState {
    // Tree structure organized by visibility
    tree: {
        bookmarked: TreeNode[];   // User's bookmarked notes (populated from bookmarks store)
        personal: TreeNode[];     // PRIVATE - only owner can see
        shared: TreeNode[];       // Notes shared with the user (GROUP visibility, not owned)
        groups: GroupTreeSection[]; // GROUP - organized by group
        organization: TreeNode[]; // ORGANIZATION - visible to all org members
        trash: TreeNode[];        // Deleted notes
    };

    // Expanded/collapsed state (note IDs and folder IDs)
    expandedNodes: string[];

    // Selected node in tree
    selectedNodeId: string | null;

    // Drag & drop state
    draggedNodeId: string | null;
    dropTargetId: string | null;

    // UI state
    treeWidth: number;
    isTreeCollapsed: boolean;

    // Loading state
    loading: boolean;
    error: string | null;
}

/**
 * Fetch and organize notes tree from API.
 * Automatically fetches all pages to build complete tree.
 */
export const fetchNotesTree = createAsyncThunk<
    NotesTreeState['tree'],
    { userGroups?: Array<{ groupId: string; groupName: string }> } | void,
    { state: RootState; rejectValue: string }
>('notesTree/fetchNotesTree', async (params, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = state.auth.currentOrganizationId;
        const currentUserId = state.auth.user?.id || '';

        if (!organizationId) {
            return rejectWithValue('No organization selected');
        }

        const pageSize = 100;

        // Fetch first page
        const firstResponse = await notesApi.listNotes({
            organizationId,
            page: 1,
            pageSize,
            includeDeleted: true,
            excludeContent: true,
        });

        const allNotes = [...firstResponse.notes];

        // Fetch remaining pages if needed
        if (firstResponse.totalPages > 1) {
            const remainingPages = Array.from(
                { length: firstResponse.totalPages - 1 },
                (_, i) => i + 2
            );

            const pageResponses = await Promise.all(
                remainingPages.map(page =>
                    notesApi.listNotes({
                        organizationId,
                        page,
                        pageSize,
                        includeDeleted: true,
                        excludeContent: true,
                    })
                )
            );

            for (const response of pageResponses) {
                allNotes.push(...response.notes);
            }
        }

        const notes = allNotes.map(noteToPlain);
        const userGroups = params?.userGroups ?? [];

        // Organize into tree structure
        const organized = organizeNotesByVisibility(notes, currentUserId, userGroups);

        return organized;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to load notes tree');
    }
});

// Empty initial state - will be populated from API
const emptyTree: NotesTreeState['tree'] = {
    bookmarked: [],
    personal: [],
    shared: [],
    groups: [],
    organization: [],
    trash: [],
};

const initialState: NotesTreeState = {
    tree: emptyTree,
    expandedNodes: ['personal'], // Personal expanded by default, will be overwritten from localStorage
    selectedNodeId: null,
    draggedNodeId: null,
    dropTargetId: null,
    treeWidth: 280, // Legacy - not used for panel sizing anymore
    isTreeCollapsed: false,
    loading: false,
    error: null,
};

export const notesTreeSlice = createSlice({
    name: 'notesTree',
    initialState,
    reducers: {
        // Set entire tree
        setTree: (state, action: PayloadAction<NotesTreeState['tree']>) => {
            state.tree = action.payload;
        },

        // Set tree nodes for a specific section
        setBookmarkedNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.bookmarked = action.payload;
        },

        setPersonalNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.personal = action.payload;
        },

        setSharedNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.shared = action.payload;
        },

        setGroupSections: (state, action: PayloadAction<GroupTreeSection[]>) => {
            state.tree.groups = action.payload;
        },

        setOrganizationNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.organization = action.payload;
        },

        setTrashNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.trash = action.payload;
        },

        // Add a single node to a section
        addNodeToSection: (state, action: PayloadAction<{
            section: 'bookmarked' | 'personal' | 'shared' | 'organization' | 'trash';
            node: TreeNode;
            parentId?: string;
        }>) => {
            const { section, node, parentId } = action.payload;
            if (parentId) {
                // TODO: Add to specific parent within section
                state.tree[section].push(node);
            } else {
                state.tree[section].push(node);
            }
        },

        // Update a node title
        updateNodeTitle: (state, action: PayloadAction<{ nodeId: string; title: string }>) => {
            const { nodeId, title } = action.payload;
            // Search all sections for the node
            const updateInArray = (nodes: TreeNode[]): boolean => {
                for (const node of nodes) {
                    if (node.id === nodeId) {
                        node.title = title;
                        return true;
                    }
                    if (node.children && updateInArray(node.children)) {
                        return true;
                    }
                }
                return false;
            };

            for (const section of ['bookmarked', 'personal', 'shared', 'organization', 'trash'] as const) {
                if (updateInArray(state.tree[section])) break;
            }
            for (const group of state.tree.groups) {
                if (updateInArray(group.nodes)) break;
            }
        },

        // Remove a node from tree
        removeNode: (state, action: PayloadAction<string>) => {
            const nodeId = action.payload;
            const removeFromArray = (nodes: TreeNode[]): TreeNode[] => {
                return nodes
                    .filter(n => n.id !== nodeId)
                    .map(n => ({
                        ...n,
                        children: n.children ? removeFromArray(n.children) : undefined,
                    }));
            };

            for (const section of ['bookmarked', 'personal', 'shared', 'organization', 'trash'] as const) {
                state.tree[section] = removeFromArray(state.tree[section]);
            }
            for (const group of state.tree.groups) {
                group.nodes = removeFromArray(group.nodes);
            }
        },

        // Expand/collapse nodes
        toggleNodeExpanded: (state, action: PayloadAction<string>) => {
            const nodeId = action.payload;
            const index = state.expandedNodes.indexOf(nodeId);
            if (index === -1) {
                state.expandedNodes.push(nodeId);
            } else {
                state.expandedNodes.splice(index, 1);
            }
        },

        expandNode: (state, action: PayloadAction<string>) => {
            if (!state.expandedNodes.includes(action.payload)) {
                state.expandedNodes.push(action.payload);
            }
        },

        collapseNode: (state, action: PayloadAction<string>) => {
            state.expandedNodes = state.expandedNodes.filter(id => id !== action.payload);
        },

        expandAll: (state) => {
            // Helper to recursively collect all folder IDs
            const collectFolderIds = (nodes: TreeNode[]): string[] => {
                const ids: string[] = [];
                for (const node of nodes) {
                    if (node.type === 'folder') {
                        ids.push(node.id);
                        if (node.children) {
                            ids.push(...collectFolderIds(node.children));
                        }
                    }
                }
                return ids;
            };

            // Expand all sections
            state.expandedNodes = ['bookmarked', 'personal', 'shared', 'organization', 'trash'];

            // Expand all group sections
            state.tree.groups.forEach(group => {
                state.expandedNodes.push(`group-${group.groupId}`);
                // Also expand all folders in this group
                state.expandedNodes.push(...collectFolderIds(group.nodes));
            });

            // Expand all folders in each section
            state.expandedNodes.push(...collectFolderIds(state.tree.bookmarked));
            state.expandedNodes.push(...collectFolderIds(state.tree.personal));
            state.expandedNodes.push(...collectFolderIds(state.tree.shared));
            state.expandedNodes.push(...collectFolderIds(state.tree.organization));
            state.expandedNodes.push(...collectFolderIds(state.tree.trash));
        },

        collapseAll: (state) => {
            state.expandedNodes = [];
        },

        // Selection
        setSelectedNode: (state, action: PayloadAction<string | null>) => {
            state.selectedNodeId = action.payload;
        },

        // Drag & drop
        setDraggedNode: (state, action: PayloadAction<string | null>) => {
            state.draggedNodeId = action.payload;
        },

        setDropTarget: (state, action: PayloadAction<string | null>) => {
            state.dropTargetId = action.payload;
        },

        // UI state
        setTreeWidth: (state, action: PayloadAction<number>) => {
            state.treeWidth = action.payload;
        },

        toggleTreeCollapsed: (state) => {
            state.isTreeCollapsed = !state.isTreeCollapsed;
        },

        setTreeCollapsed: (state, action: PayloadAction<boolean>) => {
            state.isTreeCollapsed = action.payload;
        },

        // Loading
        setTreeLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        // Error
        setTreeError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },

        // Clear tree
        clearTree: (state) => {
            state.tree = emptyTree;
            state.expandedNodes = ['personal'];
            state.selectedNodeId = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchNotesTree.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchNotesTree.fulfilled, (state, action) => {
                state.loading = false;
                state.tree = action.payload;
            })
            .addCase(fetchNotesTree.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to load notes tree';
            })
            // Sync tree when a note is updated (e.g., title change from editor)
            .addCase(updateNote.fulfilled, (state, action) => {
                const { id, title, icon } = action.payload;
                // Update the node title and icon in all sections
                const updateInArray = (nodes: TreeNode[]): boolean => {
                    for (const node of nodes) {
                        if (node.id === id) {
                            node.title = title;
                            node.icon = icon;
                            return true;
                        }
                        if (node.children && updateInArray(node.children)) {
                            return true;
                        }
                    }
                    return false;
                };

                for (const section of ['bookmarked', 'personal', 'shared', 'organization', 'trash'] as const) {
                    if (updateInArray(state.tree[section])) break;
                }
                for (const group of state.tree.groups) {
                    if (updateInArray(group.nodes)) break;
                }
            })
            // Sync tree when note icon is updated
            .addCase(updateNoteIcon.fulfilled, (state, action) => {
                const { id, icon } = action.payload;
                // Update the node icon in all sections
                const updateInArray = (nodes: TreeNode[]): boolean => {
                    for (const node of nodes) {
                        if (node.id === id) {
                            node.icon = icon;
                            return true;
                        }
                        if (node.children && updateInArray(node.children)) {
                            return true;
                        }
                    }
                    return false;
                };

                for (const section of ['bookmarked', 'personal', 'shared', 'organization', 'trash'] as const) {
                    if (updateInArray(state.tree[section])) break;
                }
                for (const group of state.tree.groups) {
                    if (updateInArray(group.nodes)) break;
                }
            })
            // Listen to unified initializeNotesData - updates tree from same API call as notesSlice
            .addCase(initializeNotesData.pending, (state, action) => {
                // Only show loading if not already loaded (prevents flash on cache load)
                const hasNodes = state.tree.personal.length > 0 ||
                    state.tree.organization.length > 0 ||
                    state.tree.shared.length > 0;
                if (!hasNodes && !action.meta.arg?.forceRefresh) {
                    state.loading = true;
                } else if (action.meta.arg?.forceRefresh) {
                    state.loading = true;
                }
                state.error = null;
            })
            .addCase(initializeNotesData.fulfilled, (state, action) => {
                state.loading = false;
                state.tree = action.payload.tree;
            })
            .addCase(initializeNotesData.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to load notes tree';
            })
            // Sync tree when a note is created
            .addCase(createNote.fulfilled, (state, action) => {
                const note = action.payload;
                const newNode: TreeNode = {
                    id: note.id,
                    title: note.title,
                    type: note.nodeType === 1 ? 'folder' : 'note', // NodeType.FOLDER = 1
                    icon: note.icon,
                    noteId: note.id,
                    visibility: note.visibility,
                    updatedAt: note.updatedAt?.seconds?.toString(),
                };

                // Helper to add node to parent or root
                const addToParent = (nodes: TreeNode[], parentId: string | undefined): boolean => {
                    if (!parentId) return false;
                    for (const node of nodes) {
                        if (node.id === parentId) {
                            if (!node.children) node.children = [];
                            node.children.push(newNode);
                            return true;
                        }
                        if (node.children && addToParent(node.children, parentId)) {
                            return true;
                        }
                    }
                    return false;
                };

                // Determine target section based on visibility
                // VisibilityScope: PRIVATE=1, GROUP=2, ORGANIZATION=3
                let targetSection: 'personal' | 'organization' = 'personal';
                if (note.visibility === VisibilityScope.ORGANIZATION) {
                    targetSection = 'organization';
                }

                // Try to add to parent, or add to root of section
                if (note.parentId) {
                    // Try all sections for parent
                    const sections = ['personal', 'organization'] as const;
                    let added = false;
                    for (const section of sections) {
                        if (addToParent(state.tree[section], note.parentId)) {
                            added = true;
                            break;
                        }
                    }
                    // Also check groups
                    if (!added) {
                        for (const group of state.tree.groups) {
                            if (addToParent(group.nodes, note.parentId)) {
                                break;
                            }
                        }
                    }
                } else {
                    // Add to root of appropriate section
                    state.tree[targetSection].push(newNode);
                }
            })
            // Sync tree when a note is deleted
            .addCase(deleteNote.fulfilled, (state, action) => {
                const { noteId, permanent } = action.payload;

                if (permanent) {
                    // Permanently deleted - remove from tree entirely
                    const removeFromArray = (nodes: TreeNode[]): TreeNode[] => {
                        return nodes
                            .filter(n => n.id !== noteId)
                            .map(n => ({
                                ...n,
                                children: n.children ? removeFromArray(n.children) : undefined,
                            }));
                    };

                    for (const section of ['bookmarked', 'personal', 'shared', 'organization', 'trash'] as const) {
                        state.tree[section] = removeFromArray(state.tree[section]);
                    }
                    for (const group of state.tree.groups) {
                        group.nodes = removeFromArray(group.nodes);
                    }
                } else {
                    // Soft deleted - move to trash
                    let removedNode: TreeNode | null = null;

                    const removeAndCapture = (nodes: TreeNode[]): TreeNode[] => {
                        const result: TreeNode[] = [];
                        for (const node of nodes) {
                            if (node.id === noteId) {
                                removedNode = { ...node };
                            } else {
                                result.push({
                                    ...node,
                                    children: node.children ? removeAndCapture(node.children) : undefined,
                                });
                            }
                        }
                        return result;
                    };

                    // Remove from all non-trash sections
                    for (const section of ['bookmarked', 'personal', 'shared', 'organization'] as const) {
                        state.tree[section] = removeAndCapture(state.tree[section]);
                    }
                    for (const group of state.tree.groups) {
                        group.nodes = removeAndCapture(group.nodes);
                    }

                    // Add to trash if found
                    if (removedNode) {
                        state.tree.trash.push(removedNode);
                    }
                }
            })
            // Sync tree when a note is restored from trash
            .addCase(restoreNote.fulfilled, (state, action) => {
                const note = action.payload;

                // Remove from trash
                state.tree.trash = state.tree.trash.filter(n => n.id !== note.id);

                // Create node from restored note
                const restoredNode: TreeNode = {
                    id: note.id,
                    title: note.title,
                    type: note.nodeType === 1 ? 'folder' : 'note',
                    icon: note.icon,
                    noteId: note.id,
                    visibility: note.visibility,
                    updatedAt: note.updatedAt?.seconds?.toString(),
                };

                // Add to appropriate section based on visibility
                if (note.visibility === VisibilityScope.ORGANIZATION) {
                    state.tree.organization.push(restoredNode);
                } else {
                    state.tree.personal.push(restoredNode);
                }
            })
            // Handle background refresh (stale-while-revalidate pattern)
            .addMatcher(
                (action): action is PayloadAction<{ tree: NotesTreeState['tree'] }> =>
                    action.type === 'notes/backgroundRefreshComplete',
                (state, action) => {
                    // Update tree silently (no loading state change)
                    state.tree = action.payload.tree;
                }
            )
            // Handle restore expanded nodes from localStorage
            .addMatcher(
                (action): action is PayloadAction<string[]> =>
                    action.type === 'notesTree/setExpandedNodesFromStorage',
                (state, action) => {
                    state.expandedNodes = action.payload;
                }
            );
    },
});

export const {
    setTree,
    setBookmarkedNodes,
    setPersonalNodes,
    setSharedNodes,
    setGroupSections,
    setOrganizationNodes,
    setTrashNodes,
    addNodeToSection,
    updateNodeTitle,
    removeNode,
    toggleNodeExpanded,
    expandNode,
    collapseNode,
    expandAll,
    collapseAll,
    setSelectedNode,
    setDraggedNode,
    setDropTarget,
    setTreeWidth,
    toggleTreeCollapsed,
    setTreeCollapsed,
    setTreeLoading,
    setTreeError,
    clearTree,
} = notesTreeSlice.actions;

export default notesTreeSlice.reducer;
