/**
 * Files Tree Redux Slice
 *
 * Manages the folder tree structure and folder operations.
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { AccessMode } from '@uniffy/proto/common/v1/common_pb';
import {
    fetchFilesTree,
    createFolder,
    updateFolder,
    deleteFolder,
    type SerializedTreeNode,
    type SerializedFolder,
} from '@/features/files/store/filesTreeThunks';

export interface FilesTreeState {
    // Tree nodes indexed by visibility section
    tree: {
        bookmarked: SerializedTreeNode[];  // User's bookmarked files (populated from bookmarks store)
        personal: SerializedTreeNode[];
        shared: SerializedTreeNode[];
        organization: SerializedTreeNode[];
    };

    // Folders indexed by ID
    folders: Record<string, SerializedFolder>;

    // Expanded node IDs
    expandedNodes: string[];

    // Selected folder ID (for navigation)
    selectedFolderId: string | null;

    // Loading states
    loading: boolean;
    creatingFolder: boolean;

    // Error states
    error: string | null;
}

const initialState: FilesTreeState = {
    tree: {
        bookmarked: [],
        personal: [],
        shared: [],
        organization: [],
    },
    folders: {},
    expandedNodes: ['bookmarked', 'personal', 'organization'], // Default expanded sections
    selectedFolderId: null,
    loading: false,
    creatingFolder: false,
    error: null,
};

export const filesTreeSlice = createSlice({
    name: 'filesTree',
    initialState,
    reducers: {
        // Toggle node expansion
        toggleNodeExpanded: (state, action: PayloadAction<string>) => {
            const nodeId = action.payload;
            const index = state.expandedNodes.indexOf(nodeId);
            if (index >= 0) {
                state.expandedNodes.splice(index, 1);
            } else {
                state.expandedNodes.push(nodeId);
            }
        },

        // Expand all nodes
        expandAll: (state) => {
            const getAllNodeIds = (nodes: SerializedTreeNode[]): string[] => {
                const ids: string[] = [];
                for (const node of nodes) {
                    ids.push(node.id);
                    if (node.children) {
                        ids.push(...getAllNodeIds(node.children));
                    }
                }
                return ids;
            };

            state.expandedNodes = [
                'bookmarked',
                'personal',
                'shared',
                'organization',
                ...getAllNodeIds(state.tree.bookmarked),
                ...getAllNodeIds(state.tree.personal),
                ...getAllNodeIds(state.tree.shared),
                ...getAllNodeIds(state.tree.organization),
            ];
        },

        // Collapse all nodes
        collapseAll: (state) => {
            state.expandedNodes = [];
        },

        // Set selected folder
        setSelectedFolder: (state, action: PayloadAction<string | null>) => {
            state.selectedFolderId = action.payload;
        },

        // Set bookmarked nodes (populated from bookmarks store)
        setBookmarkedNodes: (state, action: PayloadAction<SerializedTreeNode[]>) => {
            state.tree.bookmarked = action.payload;
        },

        // Clear tree (for logout)
        clearTree: (state) => {
            state.tree = {
                bookmarked: [],
                personal: [],
                shared: [],
                organization: [],
            };
            state.folders = {};
            state.expandedNodes = ['personal', 'organization'];
            state.selectedFolderId = null;
        },

        // Clear error
        clearError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        // fetchFilesTree
        builder
            .addCase(fetchFilesTree.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchFilesTree.fulfilled, (state, action) => {
                state.loading = false;

                // Recursively index all folders into the flat lookup map
                const indexFolders = (nodes: SerializedTreeNode[]) => {
                    for (const node of nodes) {
                        if (node.isFolder) {
                            state.folders[node.id] = {
                                id: node.id,
                                name: node.name,
                                parentId: node.parentId,
                                accessMode: node.accessMode,
                                ownerId: '',
                                isDeleted: false,
                            };
                        }
                        if (node.children) {
                            indexFolders(node.children);
                        }
                    }
                };
                indexFolders(action.payload.nodes);

                // Organize top-level nodes by visibility
                const personal: SerializedTreeNode[] = [];
                const shared: SerializedTreeNode[] = [];
                const organization: SerializedTreeNode[] = [];

                for (const node of action.payload.nodes) {
                    if (node.accessMode === AccessMode.OPEN_TO_ORG) {
                        organization.push(node);
                    } else if (node.accessMode === AccessMode.EXPLICIT_MEMBERS) {
                        shared.push(node);
                    } else {
                        personal.push(node);
                    }
                }

                state.tree = { bookmarked: state.tree.bookmarked, personal, shared, organization };
            })
            .addCase(fetchFilesTree.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch files tree';
            });

        // createFolder
        builder
            .addCase(createFolder.pending, (state) => {
                state.creatingFolder = true;
                state.error = null;
            })
            .addCase(createFolder.fulfilled, (state, action) => {
                state.creatingFolder = false;
                const folder = action.payload;

                // Add to folders map
                state.folders[folder.id] = folder;

                // Add to tree based on visibility
                const newNode: SerializedTreeNode = {
                    id: folder.id,
                    name: folder.name,
                    isFolder: true,
                    parentId: folder.parentId,
                    accessMode: folder.accessMode,
                    childCount: 0,
                    children: [],
                };

                if (folder.accessMode === AccessMode.OWNER_ONLY || folder.accessMode === AccessMode.UNSPECIFIED) {
                    if (folder.parentId) {
                        // Add as child to parent folder
                        const addToParent = (nodes: SerializedTreeNode[]): boolean => {
                            for (const node of nodes) {
                                if (node.id === folder.parentId) {
                                    if (!node.children) node.children = [];
                                    node.children.push(newNode);
                                    node.childCount = (node.childCount || 0) + 1;
                                    return true;
                                }
                                if (node.children && addToParent(node.children)) {
                                    return true;
                                }
                            }
                            return false;
                        };
                        addToParent(state.tree.personal);
                    } else {
                        state.tree.personal.push(newNode);
                    }
                } else if (folder.accessMode === AccessMode.OPEN_TO_ORG) {
                    if (folder.parentId) {
                        const addToParent = (nodes: SerializedTreeNode[]): boolean => {
                            for (const node of nodes) {
                                if (node.id === folder.parentId) {
                                    if (!node.children) node.children = [];
                                    node.children.push(newNode);
                                    node.childCount = (node.childCount || 0) + 1;
                                    return true;
                                }
                                if (node.children && addToParent(node.children)) {
                                    return true;
                                }
                            }
                            return false;
                        };
                        addToParent(state.tree.organization);
                    } else {
                        state.tree.organization.push(newNode);
                    }
                }
            })
            .addCase(createFolder.rejected, (state, action) => {
                state.creatingFolder = false;
                state.error = action.payload ?? 'Failed to create folder';
            });

        // updateFolder
        builder
            .addCase(updateFolder.fulfilled, (state, action) => {
                const folder = action.payload;
                state.folders[folder.id] = folder;

                // Update in tree
                const updateInTree = (nodes: SerializedTreeNode[]): boolean => {
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].id === folder.id) {
                            nodes[i].name = folder.name;
                            return true;
                        }
                        if (nodes[i].children && updateInTree(nodes[i].children!)) {
                            return true;
                        }
                    }
                    return false;
                };

                updateInTree(state.tree.personal);
                updateInTree(state.tree.shared);
                updateInTree(state.tree.organization);
            });

        // deleteFolder
        builder
            .addCase(deleteFolder.fulfilled, (state, action) => {
                const { folderId } = action.payload;
                delete state.folders[folderId];

                // Remove from tree
                const removeFromTree = (nodes: SerializedTreeNode[]): boolean => {
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].id === folderId) {
                            nodes.splice(i, 1);
                            return true;
                        }
                        if (nodes[i].children && removeFromTree(nodes[i].children!)) {
                            return true;
                        }
                    }
                    return false;
                };

                removeFromTree(state.tree.personal);
                removeFromTree(state.tree.shared);
                removeFromTree(state.tree.organization);

                if (state.selectedFolderId === folderId) {
                    state.selectedFolderId = null;
                }
            });
    },
});

export const {
    toggleNodeExpanded,
    expandAll,
    collapseAll,
    setSelectedFolder,
    setBookmarkedNodes,
    clearTree,
    clearError,
} = filesTreeSlice.actions;

export const filesTreeReducer = filesTreeSlice.reducer;

// Re-export thunks and types
export {
    fetchFilesTree,
    createFolder,
    updateFolder,
    deleteFolder,
    type SerializedTreeNode,
    type SerializedFolder,
} from '@/features/files/store/filesTreeThunks';
