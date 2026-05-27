import type { TreeNode } from '@/features/notes/store/notesTreeSlice';

export interface TreeNodeActions {
    onToggle: (id: string) => void;
    onSelect: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
}

export interface TreeNodeDragState {
    draggedNodeId: string | null;
    onDrop: (targetNodeId: string, droppedNodeId: string) => void;
    onDragStart: (nodeId: string) => void;
    onDragEnd: () => void;
}

export interface EditingState {
    editingId: string | null;
    onStartEdit: (id: string) => void;
    onCancelEdit: () => void;
}

export interface ActiveMenuState {
    nodeId: string;
    nodeType: 'note' | 'folder' | 'canvas';
    position: { x: number; y: number };
}

export interface MoveTarget {
    noteId: string;
    noteTitle: string;
    currentAccessMode: number;
    currentParentId: string | null;
}

export type { TreeNode };
