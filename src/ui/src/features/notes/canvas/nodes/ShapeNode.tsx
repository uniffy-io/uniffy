/**
 * ShapeNode - Canvas node that renders geometric shapes.
 *
 * Supports rect, ellipse, and diamond shapes with optional labels.
 * When selected, shows a style toolbar for fill color, border color,
 * and border width.
 */

import { memo, useCallback, useState } from 'react';
import { type NodeProps, NodeResizer, Handle, Position } from '@xyflow/react';
import { cn } from '@/shared/utils/cn';
import type { ShapeCanvasNode } from '@/features/notes/canvas/types';
import { useCanvasCallbacks } from '@/features/notes/canvas/hooks/useCanvasCallbacks';
import { NodeStyleToolbar } from '@/features/notes/canvas/components/NodeStyleToolbar';

export const ShapeNode = memo(function ShapeNode({
  id,
  data,
  selected,
}: NodeProps<ShapeCanvasNode>) {
  const { onShapeLabelChange, onNodeStyleChange, readonly } = useCanvasCallbacks();
  const fillOpacity = 1;
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '');
  const shape = data.shape || 'rect';
  const color = data.color || 'var(--color-primary)';
  const borderColor = data.borderColor || color;
  const borderWidth = data.borderWidth ?? 2;

  const handleDoubleClick = useCallback(() => {
    if (!readonly) {
      setIsEditingLabel(true);
      setLocalLabel(data.label || '');
    }
  }, [readonly, data.label]);

  const handleLabelBlur = useCallback(() => {
    setIsEditingLabel(false);
    if (localLabel !== data.label) {
      onShapeLabelChange(id, localLabel);
    }
  }, [id, localLabel, data.label, onShapeLabelChange]);

  const handleStyleChange = useCallback(
    (updates: Record<string, unknown>) => {
      onNodeStyleChange(id, updates);
    },
    [id, onNodeStyleChange]
  );

  const renderShape = () => {
    const commonProps = {
      fill: color === 'transparent' ? 'transparent' : color,
      fillOpacity: color === 'transparent' ? 1 : fillOpacity,
      stroke: borderColor === 'transparent' ? 'none' : borderColor,
      strokeWidth: borderWidth,
    };

    switch (shape) {
      case 'ellipse':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <ellipse cx="50" cy="50" rx="48" ry="48" {...commonProps} />
          </svg>
        );
      case 'diamond':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points="50,2 98,50 50,98 2,50" {...commonProps} />
          </svg>
        );
      case 'rect':
      default:
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="2" y="2" width="96" height="96" rx="4" {...commonProps} />
          </svg>
        );
    }
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={60}
        minHeight={60}
        lineClassName="!border-primary"
        handleClassName="!w-2 !h-2 !bg-primary !border-primary"
      />
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />

      <div
        className={cn(
          'relative w-full h-full',
          selected ? 'ring-1 ring-primary/30 rounded' : ''
        )}
        onDoubleClick={handleDoubleClick}
      >
        {renderShape()}

        {/* Label overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {isEditingLabel ? (
            <input
              type="text"
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              onBlur={handleLabelBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLabelBlur();
                if (e.key === 'Escape') setIsEditingLabel(false);
              }}
              className="text-center text-sm bg-transparent border-none outline-none focus:ring-0 pointer-events-auto max-w-[80%]"
              autoFocus
            />
          ) : data.label ? (
            <span className="text-sm text-foreground text-center px-2 truncate max-w-[80%]">
              {data.label}
            </span>
          ) : null}
        </div>
      </div>

      {/* Style toolbar -- shown when selected */}
      {selected && !readonly && (
        <NodeStyleToolbar
          fillColor={color}
          borderColor={borderColor}
          borderWidth={borderWidth}
          onStyleChange={handleStyleChange}
          fillFieldName="color"
          fillLabel="Fill color"
        />
      )}
    </>
  );
});
