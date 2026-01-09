import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';

export interface TreeNode {
    id: string;
    title: string;
    type: 'note' | 'folder';
    children?: TreeNode[];
    noteId?: string;
    folderId?: string;
    isPinned?: boolean;
    isExpanded?: boolean;
    visibility?: VisibilityScope;
    updatedAt?: string;
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
        pinned: TreeNode[];
        personal: TreeNode[];
        groups: GroupTreeSection[];
        organization: TreeNode[];
        trash: TreeNode[];
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
}

const initialState: NotesTreeState = {
    tree: {
        pinned: [],
        personal: [],
        groups: [],
        organization: [],
        trash: [],
    },
    expandedNodes: [],
    selectedNodeId: null,
    draggedNodeId: null,
    dropTargetId: null,
    treeWidth: 280,
    isTreeCollapsed: false,
    loading: false,
};

export const notesTreeSlice = createSlice({
    name: 'notesTree',
    initialState,
    reducers: {
        // Set tree nodes for a specific section
        setPinnedNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.pinned = action.payload;
        },

        setPersonalNodes: (state, action: PayloadAction<TreeNode[]>) => {
            state.tree.personal = action.payload;
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
            // Expand all sections
            state.expandedNodes = ['pinned', 'personal', 'organization', 'trash'];
            // Expand all group sections
            state.tree.groups.forEach(group => {
                state.expandedNodes.push(`group-${group.groupId}`);
            });
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

        // Clear tree
        clearTree: (state) => {
            state.tree = initialState.tree;
            state.expandedNodes = [];
            state.selectedNodeId = null;
        },
    },
});

export const {
    setPinnedNodes,
    setPersonalNodes,
    setGroupSections,
    setOrganizationNodes,
    setTrashNodes,
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
    clearTree,
} = notesTreeSlice.actions;

export default notesTreeSlice.reducer;
