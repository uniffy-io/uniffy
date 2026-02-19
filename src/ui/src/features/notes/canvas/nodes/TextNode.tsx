/**
 * TextNode - Floating text label on the canvas.
 *
 * Simple editable text. Click to select, double-click to type.
 * No box, no editor chrome - just text on the canvas.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { type NodeProps, NodeResizer, Handle, Position } from '@xyflow/react';
import { cn } from '@/shared/utils/cn';
import type { TextCanvasNode } from '@/features/notes/canvas/types';
import { useCanvasCallbacks } from '@/features/notes/canvas/hooks/useCanvasCallbacks';
import { TextFormatToolbar } from '@/features/notes/canvas/components/TextFormatToolbar';

export const TextNode = memo(function TextNode({
  id,
  data,
  selected,
}: NodeProps<TextCanvasNode>) {
  const {
    onTextContentChange,
    onNodeStyleChange,
    readonly,
    editingNodeId,
    clearEditingNodeId,
  } = useCanvasCallbacks();
  const [isEditing, setIsEditing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const bgColor = data.bgColor || '';
  const borderColor = data.borderColor || '';
  const borderWidth = data.borderWidth;
  const fontSize = data.fontSize ?? 14;
  const isBold = data.bold ?? false;
  const isItalic = data.italic ?? false;
  const isUnderline = data.underline ?? false;
  const textAlign = data.textAlign ?? 'left';

  // Auto-enter edit mode when this node was just created
  useEffect(() => {
    if (editingNodeId === id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting editing state when editingNodeId changes from parent
      setIsEditing(true);
      clearEditingNodeId();
    }
  }, [editingNodeId, id, clearEditingNodeId]);

  // Focus and place cursor at end when entering edit mode
  useEffect(() => {
    if (!isEditing || !textRef.current) return;
    const el = textRef.current;
    // Populate DOM with current content (only on transition to editing)
    el.innerText = data.content || '';
    el.focus();
    // Place cursor at end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on isEditing toggle

  // Exit edit mode when deselected
  useEffect(() => {
    if (!selected && isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local editing state with external selection state
      setIsEditing(false);
    }
  }, [selected, isEditing]);

  // Sync from props when NOT editing (e.g. undo/redo)
  useEffect(() => {
    if (!isEditing && textRef.current) {
      textRef.current.innerText = data.content || '';
    }
  }, [isEditing, data.content]);

  const handleDoubleClick = useCallback(() => {
    if (!readonly) {
      setIsEditing(true);
    }
  }, [readonly]);

  const handleBlur = useCallback(() => {
    if (!textRef.current) return;
    onTextContentChange(id, textRef.current.innerText);
    setIsEditing(false);
  }, [id, onTextContentChange]);

  const handleInput = useCallback(() => {
    if (!textRef.current) return;
    onTextContentChange(id, textRef.current.innerText);
  }, [id, onTextContentChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Prevent React Flow from capturing keys while typing
      e.stopPropagation();
      if (e.key === 'Escape') {
        setIsEditing(false);
        textRef.current?.blur();
      }
    },
    []
  );

  const handleStyleChange = useCallback(
    (updates: Record<string, unknown>) => {
      onNodeStyleChange(id, updates);
    },
    [id, onNodeStyleChange]
  );

  const hasBg = bgColor && bgColor !== 'transparent';
  const hasBorder = borderColor && borderColor !== 'transparent';

  const inlineStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    ...(data.color ? { borderLeftColor: data.color, borderLeftWidth: '3px' } : {}),
    ...(hasBg ? { backgroundColor: bgColor } : {}),
    ...(hasBorder ? { borderColor, borderStyle: 'solid' } : {}),
    ...(borderWidth !== undefined && hasBorder ? { borderWidth: `${borderWidth}px` } : {}),
  };

  const textStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    fontWeight: isBold ? 700 : 400,
    fontStyle: isItalic ? 'italic' : 'normal',
    textDecoration: isUnderline ? 'underline' : 'none',
    textAlign,
  };

  const showPlaceholder = !data.content && !isEditing;

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={40}
        minHeight={20}
        lineClassName="!border-primary"
        handleClassName="!w-2 !h-2 !bg-primary !border-primary"
      />
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />
      <div
        className={cn(
          'canvas-text-node text-foreground',
          hasBg || hasBorder ? 'rounded-lg' : '',
        )}
        style={inlineStyle}
        onDoubleClick={handleDoubleClick}
      >
        {showPlaceholder && (
          <div
            className="w-full h-full px-1 py-0.5 text-muted-foreground pointer-events-none absolute inset-0"
            style={{ fontSize: `${fontSize}px` }}
          >
            Double-click to type
          </div>
        )}
        <div
          ref={textRef}
          contentEditable={isEditing && !readonly}
          suppressContentEditableWarning
          className={cn(
            'w-full h-full px-1 py-0.5 outline-none whitespace-pre-wrap break-words',
            isEditing && 'nowheel nopan nodrag cursor-text',
          )}
          style={textStyle}
          onBlur={handleBlur}
          onInput={handleInput}
          onKeyDown={isEditing ? handleKeyDown : undefined}
          onMouseDown={isEditing ? (e) => e.stopPropagation() : undefined}
        />
      </div>

      {selected && !readonly && (
        <TextFormatToolbar
          bold={isBold}
          italic={isItalic}
          underline={isUnderline}
          fontSize={fontSize}
          textAlign={textAlign}
          fillColor={bgColor || 'transparent'}
          borderColor={borderColor || 'transparent'}
          borderWidth={borderWidth ?? 1}
          onStyleChange={handleStyleChange}
        />
      )}
    </>
  );
});
