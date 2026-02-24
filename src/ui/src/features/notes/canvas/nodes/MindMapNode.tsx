/**
 * MindMapNode - Canvas node for mind map branches and roots.
 *
 * Renders as a rounded pill. Root nodes use primary theme color and
 * are draggable to reposition the whole mind map. Branch nodes show
 * a colored left accent border matching their branch.
 * Supports inline label editing and collapse/expand toggle.
 * Tree operations (add child, sibling, color) are in the context menu.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { type NodeProps, Handle, Position } from '@xyflow/react';
import { cn } from '@/shared/utils/cn';
import type { MindMapCanvasNode } from '@/features/notes/canvas/types';
import type { MindMapDirection } from '@/features/notes/canvas/components/mindmapConstants';
import { useCanvasCallbacks } from '@/features/notes/canvas/hooks/useCanvasCallbacks';
import { TextFormatToolbar } from '@/features/notes/canvas/components/TextFormatToolbar';

export const MindMapNode = memo(function MindMapNode({
  id,
  data,
  selected,
}: NodeProps<MindMapCanvasNode>) {
  const {
    onMindMapLabelChange,
    onNodeStyleChange,
    readonly,
    editingNodeId,
    clearEditingNodeId,
  } = useCanvasCallbacks();

  const [isEditing, setIsEditing] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isRoot = data.isRoot === true;
  const isCollapsed = data.collapsed === true;
  const hasChildren = data.children.length > 0;
  const branchColor = data.branchColor || '';
  const direction: MindMapDirection = data.direction || 'right';

  const fontSize = data.fontSize ?? 14;
  const isBold = data.bold ?? false;
  const isItalic = data.italic ?? false;
  const isUnderline = data.underline ?? false;
  const textAlign = (data.textAlign as 'left' | 'center' | 'right') ?? 'left';
  const bgColor = data.bgColor || '';
  const borderColor = data.borderColor || '';
  const borderWidth = data.borderWidth;

  const handleStyleChange = useCallback(
    (updates: Record<string, unknown>) => {
      // For non-root nodes, fill color changes the branch color (edge color)
      if ('bgColor' in updates && !isRoot) {
        onNodeStyleChange(id, { branchColor: updates.bgColor as string });
        return;
      }
      onNodeStyleChange(id, updates);
    },
    [id, isRoot, onNodeStyleChange],
  );

  const textStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    fontWeight: isBold ? 700 : 400,
    fontStyle: isItalic ? 'italic' : 'normal',
    textDecoration: isUnderline ? 'underline' : 'none',
    textAlign,
    lineHeight: 1.5,
  };

  // Enter edit mode when selected or for newly created nodes (editingNodeId).
  // Exit edit mode and commit label when deselected.
  useEffect(() => {
    if (editingNodeId === id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing editing state for newly created node
      setIsEditing(true);
      setLocalLabel(data.label || '');
      clearEditingNodeId();
    } else if (selected && !isEditing && !readonly) {
      setIsEditing(true);
      setLocalLabel(data.label || '');
    } else if (!selected && isEditing) {
      setIsEditing(false);
      const trimmed = localLabel.trim();
      if (trimmed !== data.label) {
        onMindMapLabelChange?.(id, trimmed || 'Untitled');
      }
    }
  }, [selected, editingNodeId, id, clearEditingNodeId, data.label, readonly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Place cursor at end when entering edit mode
  useEffect(() => {
    if (!isEditing || !inputRef.current) return;
    const el = inputRef.current;
    el.focus();
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
  }, [isEditing]);

  const handleDoubleClick = useCallback(() => {
    if (!readonly && !isEditing) {
      setIsEditing(true);
      setLocalLabel(data.label || '');
    }
  }, [readonly, isEditing, data.label]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    const trimmed = localLabel.trim();
    if (trimmed !== data.label) {
      onMindMapLabelChange?.(id, trimmed || 'Untitled');
    }
  }, [id, localLabel, data.label, onMindMapLabelChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        inputRef.current?.blur();
      }
    },
    []
  );

  // Resolve handle positions based on layout direction
  const isHorizontal = direction === 'right' || direction === 'left';
  const targetPos = isHorizontal
    ? (direction === 'right' ? Position.Left : Position.Right)
    : (direction === 'down' ? Position.Top : Position.Bottom);
  const sourcePos = isHorizontal
    ? (direction === 'right' ? Position.Right : Position.Left)
    : (direction === 'down' ? Position.Bottom : Position.Top);

  // Border accent side: always on the incoming side
  const accentSide = isHorizontal
    ? (direction === 'right' ? 'borderLeftWidth' : 'borderRightWidth')
    : (direction === 'down' ? 'borderTopWidth' : 'borderBottomWidth');
  const accentColor = isHorizontal
    ? (direction === 'right' ? 'borderLeftColor' : 'borderRightColor')
    : (direction === 'down' ? 'borderTopColor' : 'borderBottomColor');

  return (
    <>
      {/* Target handle (incoming edge from parent) */}
      {!isRoot && (
        <Handle
          type="target"
          position={targetPos}
          id="mm-target"
          className="!bg-transparent !border-0 !w-1 !h-1"
        />
      )}

      {/* Node body */}
      <div
        onDoubleClick={handleDoubleClick}
        className={cn(
          'flex items-center gap-1.5 rounded-lg transition-shadow duration-150 w-max',
          isEditing ? 'nodrag nopan nowheel cursor-text' : cn('select-none', isRoot ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'),
          isRoot
            ? cn(!bgColor && 'bg-primary', 'text-primary-foreground px-4 py-2.5 shadow-md min-w-40')
            : cn(!bgColor && 'bg-card', 'text-card-foreground px-3 py-2 border border-border shadow-sm min-w-30'),
          selected && !isRoot && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
          selected && isRoot && 'ring-2 ring-primary-foreground/40 ring-offset-1 ring-offset-primary',
        )}
        style={{
          ...(!isRoot && branchColor ? { [accentSide]: '3px', [accentColor]: branchColor } : {}),
          ...(bgColor ? { backgroundColor: bgColor } : {}),
          ...(borderColor && borderColor !== 'transparent' ? { borderColor, borderStyle: 'solid' } : {}),
          ...(borderWidth !== undefined && borderColor && borderColor !== 'transparent' ? { borderWidth: `${borderWidth}px` } : {}),
        }}
      >
        {/* Label - sizer span keeps layout stable; textarea overlays when editing */}
        <div className="relative flex-1 min-w-0">
          <span
            className="whitespace-pre-wrap block"
            style={{ ...textStyle, visibility: isEditing ? 'hidden' : 'visible' }}
          >
            {isEditing ? (localLabel || 'Untitled') : (data.label || 'Untitled')}
          </span>
          {isEditing && (
            <textarea
              ref={inputRef}
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                'absolute inset-0 bg-transparent border-none outline-none focus:ring-0 resize-none overflow-hidden p-0 m-0 nowheel nopan nodrag',
                isRoot ? 'text-primary-foreground placeholder:text-primary-foreground/50' : 'text-card-foreground placeholder:text-muted-foreground',
              )}
              style={{ ...textStyle, fontFamily: 'inherit' }}
              placeholder="Type a label..."
            />
          )}
        </div>

        {/* Collapsed indicator */}
        {isCollapsed && hasChildren && (
          <span
            className={cn(
              'text-[10px] font-medium px-1 py-0.5 rounded',
              isRoot
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {data.children.length}
          </span>
        )}

      </div>

      {/* Source handle (outgoing edges to children) */}
      <Handle
        type="source"
        position={sourcePos}
        id="mm-source"
        className="!bg-transparent !border-0 !w-1 !h-1"
      />

      {/* Text format toolbar */}
      {selected && !readonly && (
        <TextFormatToolbar
          bold={isBold}
          italic={isItalic}
          underline={isUnderline}
          fontSize={fontSize}
          textAlign={textAlign}
          fillColor={isRoot ? (bgColor || 'transparent') : (branchColor || 'transparent')}
          borderColor={borderColor || 'transparent'}
          borderWidth={borderWidth ?? 1}
          onStyleChange={handleStyleChange}
        />
      )}
    </>
  );
});
