/**
 * Notes Tree Utilities
 *
 * Helper functions for transforming flat notes data into tree structure
 * organized by visibility scope.
 */

import { NodeType, VisibilityScope } from '@/gen/notes/v1/notes_pb';
import type { TreeNode, GroupTreeSection } from '@/features/notes/store/notesTreeSlice';
import type { SerializedNote } from '@/features/notes/store/notesThunks';

/**
 * Convert NodeType enum to TreeNode type string.
 */
function nodeTypeToTreeType(nodeType: NodeType): 'note' | 'folder' | 'canvas' {
    if (nodeType === NodeType.FOLDER) return 'folder';
    if (nodeType === NodeType.CANVAS) return 'canvas';
    return 'note';
}

/**
 * Convert a Note to a TreeNode.
 * Note: Bookmark status is managed separately in the bookmarks store.
 */
export function noteToTreeNode(note: SerializedNote): TreeNode {
    return {
        id: note.id,
        title: note.title,
        type: nodeTypeToTreeType(note.nodeType),
        icon: note.icon,
        noteId: note.id,
        visibility: note.visibility,
        updatedAt: note.updatedAt?.seconds?.toString(),
        // Include owner info for shared notes
        ownerInfo: note.ownerInfo,
        // Mark note as shared if it has share targets
        isShared: note.sharedWith && note.sharedWith.length > 0,
    };
}

/**
 * Sort tree nodes: folders first, then notes, alphabetically within each group.
 */
export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
        // Folders come before notes
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;

        // Within same type, sort alphabetically (case-insensitive)
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
}

/**
 * Build a hierarchical tree from flat notes array.
 * Notes with parentId are nested under their parent.
 * Sorts folders first, then notes, alphabetically.
 */
export function buildNoteHierarchy(notes: SerializedNote[]): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];

    // First pass: create all nodes
    notes.forEach((note) => {
        nodeMap.set(note.id, noteToTreeNode(note));
    });

    // Second pass: establish parent-child relationships
    notes.forEach((note) => {
        const node = nodeMap.get(note.id)!;
        if (note.parentId && nodeMap.has(note.parentId)) {
            const parent = nodeMap.get(note.parentId)!;
            if (!parent.children) {
                parent.children = [];
            }
            parent.children.push(node);
        } else {
            rootNodes.push(node);
        }
    });

    // Sort root nodes (folders first, then alphabetically)
    sortTreeNodes(rootNodes);

    // Recursively sort children
    const sortChildren = (node: TreeNode) => {
        if (node.children && node.children.length > 0) {
            sortTreeNodes(node.children);
            node.children.forEach(sortChildren);
        }
    };
    rootNodes.forEach(sortChildren);

    return rootNodes;
}

/**
 * Organize notes by visibility scope.
 * Note: The bookmarked section is populated separately by the component using the bookmarks API.
 */
export interface OrganizedNotes {
    bookmarked: TreeNode[];
    personal: TreeNode[];
    shared: TreeNode[];
    groups: GroupTreeSection[];
    organization: TreeNode[];
    trash: TreeNode[];
}

/**
 * Organize flat notes array into tree structure by visibility.
 */
/**
 * Organize flat notes array into tree structure by visibility.
 * Note: The bookmarked section is empty here - it's populated separately by the
 * NotesSidebar component using the bookmarks API since bookmarks are user-scoped.
 */
export function organizeNotesByVisibility(
    notes: SerializedNote[],
    currentUserId: string,
    userGroups: Array<{ groupId: string; groupName: string }>
): OrganizedNotes {
    const personal: SerializedNote[] = [];
    const shared: SerializedNote[] = [];
    const organization: SerializedNote[] = [];
    const trash: SerializedNote[] = [];
    const groupNotes: Record<string, SerializedNote[]> = {};

    // Initialize group note arrays
    userGroups.forEach((g) => {
        groupNotes[g.groupId] = [];
    });

    // Sort notes into categories
    notes.forEach((note) => {
        if (note.isDeleted) {
            trash.push(note);
            return;
        }

        switch (note.visibility) {
            case VisibilityScope.PRIVATE:
                if (note.ownerId === currentUserId) {
                    personal.push(note);
                } else {
                    // Private note not owned by user - must be explicitly shared with us
                    shared.push(note);
                }
                break;

            case VisibilityScope.GROUP:
                // Notes shared with groups
                if (note.ownerId === currentUserId) {
                    // User owns this group note - put in each group
                    note.groupIds.forEach((groupId) => {
                        if (groupNotes[groupId]) {
                            groupNotes[groupId].push(note);
                        }
                    });
                } else {
                    // Shared with user from someone else
                    shared.push(note);
                }
                break;

            case VisibilityScope.ORGANIZATION:
                organization.push(note);
                break;

            default:
                // UNSPECIFIED or PUBLIC - treat as personal for now
                if (note.ownerId === currentUserId) {
                    personal.push(note);
                }
        }
    });

    // Build hierarchies for each section
    // Note: bookmarked is empty - populated separately by component using bookmarks API
    const result: OrganizedNotes = {
        bookmarked: [],
        personal: buildNoteHierarchy(personal),
        shared: buildNoteHierarchy(shared),
        groups: userGroups.map((g) => ({
            groupId: g.groupId,
            groupName: g.groupName,
            isExpanded: false,
            nodes: buildNoteHierarchy(groupNotes[g.groupId] || []),
        })),
        organization: buildNoteHierarchy(organization),
        trash: trash.map(noteToTreeNode),
    };

    return result;
}

/**
 * Find a node in the tree by ID.
 */
export function findNodeInTree(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
        if (node.id === id) {
            return node;
        }
        if (node.children) {
            const found = findNodeInTree(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Add a node to the tree at a specific parent.
 */
export function addNodeToTree(
    nodes: TreeNode[],
    newNode: TreeNode,
    parentId?: string
): TreeNode[] {
    if (!parentId) {
        return [...nodes, newNode];
    }

    return nodes.map((node) => {
        if (node.id === parentId) {
            return {
                ...node,
                type: 'folder' as const,
                children: [...(node.children || []), newNode],
            };
        }
        if (node.children) {
            return {
                ...node,
                children: addNodeToTree(node.children, newNode, parentId),
            };
        }
        return node;
    });
}

/**
 * Remove a node from the tree.
 */
export function removeNodeFromTree(nodes: TreeNode[], nodeId: string): TreeNode[] {
    return nodes
        .filter((node) => node.id !== nodeId)
        .map((node) => {
            if (node.children) {
                return {
                    ...node,
                    children: removeNodeFromTree(node.children, nodeId),
                };
            }
            return node;
        });
}

/**
 * Update a node in the tree.
 */
export function updateNodeInTree(
    nodes: TreeNode[],
    nodeId: string,
    updates: Partial<TreeNode>
): TreeNode[] {
    return nodes.map((node) => {
        if (node.id === nodeId) {
            return { ...node, ...updates };
        }
        if (node.children) {
            return {
                ...node,
                children: updateNodeInTree(node.children, nodeId, updates),
            };
        }
        return node;
    });
}

export interface BreadcrumbItem {
    id: string;
    title: string;
    isFolder: boolean;
}

/**
 * Build breadcrumb path for a note by traversing parent folders.
 * Returns array of breadcrumb items from root to the note.
 */
export function buildBreadcrumbPath(
    notes: SerializedNote[],
    noteId: string
): BreadcrumbItem[] {
    const noteMap = new Map<string, SerializedNote>();
    notes.forEach(note => noteMap.set(note.id, note));

    const path: BreadcrumbItem[] = [];
    let currentNote = noteMap.get(noteId);

    // Traverse up the parent chain
    while (currentNote) {
        path.unshift({
            id: currentNote.id,
            title: currentNote.title,
            isFolder: currentNote.nodeType === NodeType.FOLDER,
        });
        if (currentNote.parentId) {
            currentNote = noteMap.get(currentNote.parentId);
        } else {
            break;
        }
    }

    return path;
}
