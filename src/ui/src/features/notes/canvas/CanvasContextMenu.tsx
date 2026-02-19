/**
 * CanvasContextMenu - Right-click context menu for canvas nodes.
 *
 * Provides: Duplicate, Delete, and node ordering (Bring to Front, etc.).
 */

import { memo, useEffect, useRef } from 'react';
import { Trash, CopySimple, ArrowLineUp, ArrowLineDown, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface CanvasContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onBringToFront: (nodeId: string) => void;
  onSendToBack: (nodeId: string) => void;
  onBringForward: (nodeId: string) => void;
  onSendBackward: (nodeId: string) => void;
}

interface MenuItem {
  label: string;
  icon: React.ComponentType<{ size: number; weight: string; className?: string }>;
  action: () => void;
  variant?: 'destructive';
}

export const CanvasContextMenu = memo(function CanvasContextMenu({
  x,
  y,
  nodeId,
  onClose,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const editItems: MenuItem[] = [
    {
      label: 'Duplicate',
      icon: CopySimple as MenuItem['icon'],
      action: () => {
        onDuplicate(nodeId);
        onClose();
      },
    },
    {
      label: 'Delete',
      icon: Trash as MenuItem['icon'],
      action: () => {
        onDelete(nodeId);
        onClose();
      },
      variant: 'destructive',
    },
  ];

  const orderItems: MenuItem[] = [
    {
      label: 'Bring to Front',
      icon: ArrowLineUp as MenuItem['icon'],
      action: () => {
        onBringToFront(nodeId);
        onClose();
      },
    },
    {
      label: 'Bring Forward',
      icon: ArrowUp as MenuItem['icon'],
      action: () => {
        onBringForward(nodeId);
        onClose();
      },
    },
    {
      label: 'Send Backward',
      icon: ArrowDown as MenuItem['icon'],
      action: () => {
        onSendBackward(nodeId);
        onClose();
      },
    },
    {
      label: 'Send to Back',
      icon: ArrowLineDown as MenuItem['icon'],
      action: () => {
        onSendToBack(nodeId);
        onClose();
      },
    },
  ];

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon;
    return (
      <button
        key={item.label}
        onClick={item.action}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
          item.variant === 'destructive'
            ? 'text-red-500 hover:bg-red-500/10'
            : 'text-foreground hover:bg-muted'
        )}
      >
        <Icon size={14} weight="duotone" />
        {item.label}
      </button>
    );
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {editItems.map(renderItem)}
      <div className="h-px bg-border my-1" />
      {orderItems.map(renderItem)}
    </div>
  );
});
