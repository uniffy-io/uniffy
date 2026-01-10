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
        pinned: TreeNode[];      // Favorited/pinned notes (any visibility)
        personal: TreeNode[];    // PRIVATE - only owner can see
        shared: TreeNode[];      // Notes shared with the user (GROUP visibility, not owned)
        groups: GroupTreeSection[]; // GROUP - organized by group
        organization: TreeNode[]; // ORGANIZATION - visible to all org members
        trash: TreeNode[];       // Deleted notes
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

// Mock data for development - showcases all visibility scopes
const mockPinnedNodes: TreeNode[] = [
    { id: 'fav-1', title: 'Quick Reference', type: 'note', noteId: 'fav-1', isPinned: true, visibility: VisibilityScope.PRIVATE },
    { id: 'fav-2', title: 'Meeting Notes Template', type: 'note', noteId: 'fav-2', isPinned: true, visibility: VisibilityScope.ORGANIZATION },
];

const mockPersonalNodes: TreeNode[] = [
    { id: 'personal-1', title: 'My Ideas', type: 'note', noteId: 'personal-1', visibility: VisibilityScope.PRIVATE },
    { id: 'personal-2', title: 'Personal Journal', type: 'note', noteId: 'personal-2', visibility: VisibilityScope.PRIVATE },
    { id: 'personal-3', title: 'Learning Notes', type: 'note', noteId: 'personal-3', visibility: VisibilityScope.PRIVATE },
];

const mockSharedNodes: TreeNode[] = [
    { id: 'shared-1', title: 'Project Brief (from Sarah)', type: 'note', noteId: 'shared-1', visibility: VisibilityScope.GROUP },
    { id: 'shared-2', title: 'Design Specs (from Mike)', type: 'note', noteId: 'shared-2', visibility: VisibilityScope.GROUP },
];

const mockGroupSections: GroupTreeSection[] = [
    {
        groupId: 'eng',
        groupName: 'Engineering',
        isExpanded: true,
        nodes: [
            { id: 'eng-1', title: 'Q1 Roadmap', type: 'note', noteId: 'eng-1', visibility: VisibilityScope.GROUP },
            { id: 'eng-2', title: 'Architecture Docs', type: 'note', noteId: 'eng-2', visibility: VisibilityScope.GROUP },
            { id: 'eng-3', title: 'Sprint Planning', type: 'note', noteId: 'eng-3', visibility: VisibilityScope.GROUP },
        ],
    },
    {
        groupId: 'product',
        groupName: 'Product',
        isExpanded: false,
        nodes: [
            { id: 'prod-1', title: 'Feature Specs', type: 'note', noteId: 'prod-1', visibility: VisibilityScope.GROUP },
            { id: 'prod-2', title: 'User Research', type: 'note', noteId: 'prod-2', visibility: VisibilityScope.GROUP },
        ],
    },
    {
        groupId: 'design',
        groupName: 'Design',
        isExpanded: false,
        nodes: [
            { id: 'design-1', title: 'Brand Guidelines', type: 'note', noteId: 'design-1', visibility: VisibilityScope.GROUP },
        ],
    },
];

const mockOrganizationNodes: TreeNode[] = [
    { id: 'org-1', title: 'Company Handbook', type: 'note', noteId: 'org-1', visibility: VisibilityScope.ORGANIZATION },
    { id: 'org-2', title: 'Onboarding Guide', type: 'note', noteId: 'org-2', visibility: VisibilityScope.ORGANIZATION },
    { id: 'org-3', title: 'Engineering Standards', type: 'note', noteId: 'org-3', visibility: VisibilityScope.ORGANIZATION },
];

const mockTrashNodes: TreeNode[] = [
    { id: 'trash-1', title: 'Old Draft', type: 'note', noteId: 'trash-1', visibility: VisibilityScope.PRIVATE },
];

const initialState: NotesTreeState = {
    tree: {
        pinned: mockPinnedNodes,
        personal: mockPersonalNodes,
        shared: mockSharedNodes,
        groups: mockGroupSections,
        organization: mockOrganizationNodes,
        trash: mockTrashNodes,
    },
    expandedNodes: ['personal', 'group-eng'], // Personal and Engineering expanded by default
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
            state.expandedNodes = ['pinned', 'personal', 'shared', 'organization', 'trash'];
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
    setSharedNodes,
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
