import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import type { TreeNode } from '@/features/notes/store/notesTreeSlice';
import { bucketForContent } from '@/shared/utils/contentRoles';
import type { SerializedNote } from '@/features/notes/store/notesThunks';

function nodeTypeToTreeType(nodeType: NodeType): 'note' | 'folder' | 'canvas' {
    if (nodeType === NodeType.FOLDER) return 'folder';
    if (nodeType === NodeType.CANVAS) return 'canvas';
    return 'note';
}

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

/** Folders first, then notes, alphabetically. */
export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
}

export function buildNoteHierarchy(notes: SerializedNote[]): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];

    notes.forEach((note) => {
        nodeMap.set(note.id, noteToTreeNode(note));
    });

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

    sortTreeNodes(rootNodes);

    const sortChildren = (node: TreeNode) => {
        if (node.children && node.children.length > 0) {
            sortTreeNodes(node.children);
            node.children.forEach(sortChildren);
        }
    };
    rootNodes.forEach(sortChildren);

    return rootNodes;
}

export interface OrganizedNotes {
    bookmarked: TreeNode[];
    personal: TreeNode[];
    shared: TreeNode[];
    organization: TreeNode[];
    trash: TreeNode[];
}

/** The `bookmarked` section is populated by NotesSidebar separately since bookmarks are user-scoped. */
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

export function buildBreadcrumbPath(
    notes: SerializedNote[],
    noteId: string
): BreadcrumbItem[] {
    const noteMap = new Map<string, SerializedNote>();
    notes.forEach(note => noteMap.set(note.id, note));

    const path: BreadcrumbItem[] = [];
    let currentNote = noteMap.get(noteId);

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
