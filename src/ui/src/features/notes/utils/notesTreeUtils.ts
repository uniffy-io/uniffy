/**
 * Notes Tree Utilities
 *
 * Helper functions for transforming flat notes data into tree structure
 * organized by visibility scope.
 */

import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import type { TreeNode } from '@/features/notes/store/notesTreeSlice';
import { bucketForContent } from '@/shared/utils/contentRoles';
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
        accessMode: note.accessMode,
        ownerId: note.ownerId,
        updatedAt: note.updatedAt?.seconds?.toString(),
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
    organization: TreeNode[];
    trash: TreeNode[];
}

/**
 * Organize flat notes array into tree structure by access mode section.
 * The bookmarked section is empty here - populated separately by the
 * NotesSidebar component using the bookmarks API since bookmarks are user-scoped.
 */
export function organizeNotesBySection(
    notes: SerializedNote[],
    currentUserId: string,
): OrganizedNotes {
    const personal: SerializedNote[] = [];
    const shared: SerializedNote[] = [];
    const organization: SerializedNote[] = [];
    const trash: SerializedNote[] = [];

    notes.forEach((note) => {
        if (note.isDeleted) {
            trash.push(note);
            return;
        }

        const bucket = bucketForContent({
            ownerId: note.ownerId,
            accessMode: note.accessMode,
            currentUserId,
        });

        switch (bucket) {
            case 'personal':
                personal.push(note);
                break;
            case 'shared':
                shared.push(note);
                break;
            case 'organization':
                organization.push(note);
                break;
        }
    });

    return {
        bookmarked: [],
        personal: buildNoteHierarchy(personal),
        shared: buildNoteHierarchy(shared),
        organization: buildNoteHierarchy(organization),
        trash: trash.map(noteToTreeNode),
    };
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
