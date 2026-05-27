import { useState, useRef, useEffect, useCallback } from 'react';
import {
    CaretDown,
    CaretRight,
    Folder,
    BookmarkSimple as BookmarkSimpleIcon,
    SelectionAll,
    DotsThree,
} from '@phosphor-icons/react';
import { useIsBookmarked } from '@/features/bookmarks';
import { renderNoteIcon } from '@/features/notes/utils/noteIcons';
import { CreateDropdown } from '@/features/notes/components/sidebar/CreateDropdown';
import type { TreeNodeActions, TreeNodeDragState, EditingState, TreeNode } from '@/features/notes/components/sidebar/types';

interface TreeNodeItemProps {
    node: TreeNode;
    depth?: number;
    isExpanded: boolean;
    isSelected: boolean;
    actions: TreeNodeActions;
    drag: TreeNodeDragState;
    editing: EditingState;
    isNodeExpanded: (nodeId: string) => boolean;
    isNodeSelected: (nodeId: string) => boolean;
    onOpenMenu: (nodeId: string, nodeType: 'note' | 'folder' | 'canvas', position: { x: number; y: number }) => void;
    onCreateNote: (parentId: string) => void;
    onCreateCanvas: (parentId: string) => void;
    onCreateFolder: (parentId: string) => void;
}

export function TreeNodeItem({
    node,
    depth = 0,
    isExpanded,
    isSelected,
    actions,
    drag,
    editing,
    isNodeExpanded,
    isNodeSelected,
    onOpenMenu,
    onCreateNote,
    onCreateCanvas,
    onCreateFolder,
}: TreeNodeItemProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const [editValue, setEditValue] = useState(node.title);
    const [isDragOver, setIsDragOver] = useState(false);
    const isFolder = node.type === 'folder';
    const hasChildren = isFolder && node.children && node.children.length > 0;
    const isEditing = editing.editingId === node.id;
    const isDragging = drag.draggedNodeId === node.id;

    const noteUrn = node.noteId ? `urn:uniffy:content:NOTE:${node.noteId}` : '';
    const isBookmarked = useIsBookmarked(noteUrn);

    // Prevent dropping into own descendants.
    const isDescendant = (nodeToCheck: TreeNode, targetId: string): boolean => {
        if (nodeToCheck.id === targetId) return true;
        if (!nodeToCheck.children) return false;
        return nodeToCheck.children.some(child => isDescendant(child, targetId));
    };

    const canDropHere = isFolder && drag.draggedNodeId !== node.id && (!drag.draggedNodeId || !isDescendant(node, drag.draggedNodeId));

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
            setEditValue(node.title);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run when isEditing changes
    }, [isEditing]);

    const handleSubmitRename = useCallback(() => {
        if (editValue.trim() && editValue !== node.title) {
            actions.onRename(node.id, editValue.trim());
        }
        editing.onCancelEdit();
    }, [editValue, node.title, node.id, actions, editing]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmitRename();
        } else if (e.key === 'Escape') {
            setEditValue(node.title);
            editing.onCancelEdit();
        }
    }, [handleSubmitRename, node.title, editing]);

    const handleMenuClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const rect = menuButtonRef.current?.getBoundingClientRect();
        if (!rect) return;

        const menuWidth = 180;
        const menuHeight = 200;
        const x = rect.right + menuWidth > window.innerWidth ? rect.left - menuWidth : rect.right;
        const y = rect.bottom + menuHeight > window.innerHeight ? rect.top - menuHeight : rect.bottom;

        onOpenMenu(node.id, node.type, { x, y });
    }, [node.id, node.type, onOpenMenu]);

    const renderEditInput = () => (
        <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSubmitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-background border border-input rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
    );

    const renderDotsButton = () => (
        <button
            ref={menuButtonRef}
            onClick={handleMenuClick}
            className="p-0.5 rounded hover:bg-muted cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
            title="Actions"
        >
            <DotsThree size={16} weight="bold" className="text-muted-foreground" />
        </button>
    );

    const renderHoverActions = () => (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
            {isFolder && (
                <CreateDropdown
                    compact
                    onCreateNote={() => onCreateNote(node.id)}
                    onCreateCanvas={() => onCreateCanvas(node.id)}
                    onCreateFolder={() => onCreateFolder(node.id)}
                />
            )}
            {renderDotsButton()}
        </div>
    );

    if (isFolder) {
        return (
            <div data-node-id={node.id}>
                <div
                    draggable={!isEditing}
                    onDragStart={(e) => {
                        e.stopPropagation();
                        drag.onDragStart(node.id);
                    }}
                    onDragEnd={drag.onDragEnd}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group ${
                        isDragOver ? 'bg-primary/10 ring-2 ring-primary' : ''
                    } ${isDragging ? 'opacity-50' : ''} ${isSelected ? 'bg-accent ring-2 ring-primary/50' : ''}`}
                    onDragOver={(e) => {
                        if (canDropHere) {
                            e.preventDefault();
                            setIsDragOver(true);
                        }
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDragOver(false);
                        if (canDropHere && drag.draggedNodeId) {
                            drag.onDrop(node.id, drag.draggedNodeId);
                        }
                    }}
                >
                    <button onClick={() => actions.onToggle(node.id)} className="flex items-center">
                        {isExpanded ? (
                            <CaretDown size={14} weight="bold" className="text-muted-foreground" />
                        ) : (
                            <CaretRight size={14} weight="bold" className="text-muted-foreground" />
                        )}
                    </button>
                    <Folder size={16} weight="duotone" className="text-muted-foreground shrink-0" />
                    {isEditing ? renderEditInput() : (
                        <span
                            className="flex-1 truncate cursor-pointer"
                            onDoubleClick={() => editing.onStartEdit(node.id)}
                        >
                            {node.title}
                        </span>
                    )}
                    {renderHoverActions()}
                </div>
                {isExpanded && hasChildren && (
                    <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5">
                        {node.children!.map((child) => (
                            <TreeNodeItem
                                key={child.id}
                                node={child}
                                depth={depth + 1}
                                isExpanded={isNodeExpanded(child.id)}
                                isSelected={isNodeSelected(child.id)}
                                actions={actions}
                                drag={drag}
                                editing={editing}
                                isNodeExpanded={isNodeExpanded}
                                isNodeSelected={isNodeSelected}
                                onOpenMenu={onOpenMenu}
                                onCreateNote={onCreateNote}
                                onCreateCanvas={onCreateCanvas}
                                onCreateFolder={onCreateFolder}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div
            data-node-id={node.id}
            draggable={!isEditing}
            onDragStart={(e) => {
                e.stopPropagation();
                drag.onDragStart(node.id);
            }}
            onDragEnd={drag.onDragEnd}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer ${
                isSelected ? 'bg-accent text-accent-foreground' : ''
            } ${isDragging ? 'opacity-50' : ''}`}
            onClick={() => actions.onSelect(node.id)}
        >
            {node.type === 'canvas' ? (
                <SelectionAll size={16} weight="duotone" className="text-muted-foreground shrink-0" />
            ) : (
                renderNoteIcon(node.icon, "h-4 w-4 text-muted-foreground shrink-0")
            )}
            {isBookmarked && (
                <BookmarkSimpleIcon size={12} weight="fill" className="text-primary shrink-0" />
            )}
            {isEditing ? renderEditInput() : (
                <span
                    className="flex-1 truncate"
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        editing.onStartEdit(node.id);
                    }}
                >
                    {node.title}
                </span>
            )}
            {renderHoverActions()}
        </div>
    );
}
