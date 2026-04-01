/**
 * CategorySection - Collapsible channel category in the sidebar.
 *
 * Shows a category header with name, collapse chevron, drag handle, and "+" button.
 * When expanded, renders the channel list items with a smooth height animation.
 * When collapsed, shows aggregate unread count on the header.
 * Supports drag-and-drop reordering via @dnd-kit when `sortable` is true.
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import {
  CaretDown,
  Plus,
} from '@phosphor-icons/react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/shared/utils/cn';

interface CategorySectionProps {
  id?: string | null;
  name: string;
  defaultCollapsed?: boolean;
  unreadCount?: number;
  sortable?: boolean;
  onAddChannel?: () => void;
  children: ReactNode;
}

export function CategorySection({
  id,
  name,
  defaultCollapsed = false,
  unreadCount = 0,
  sortable = false,
  onAddChannel,
  children,
}: CategorySectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: id ?? 'uncategorized',
    disabled: !sortable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Measure content height for animation
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (!collapsed) {
      setContentHeight(el.scrollHeight);
      const timer = setTimeout(() => setContentHeight('auto'), 200);
      return () => clearTimeout(timer);
    } else {
      setContentHeight(el.scrollHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setContentHeight(0);
        });
      });
    }
  }, [collapsed]);

  const handleToggle = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'mt-1',
        isDragging && 'opacity-50 z-50',
      )}
    >
      {/* Category header - entire row is draggable when sortable */}
      <div
        className={cn(
          'flex items-center w-full px-3 py-1.5 group',
          sortable && 'cursor-grab active:cursor-grabbing',
        )}
        {...(sortable ? { ...attributes, ...listeners } : {})}
      >
        {/* Toggle + name */}
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground flex-1 min-w-0"
        >
          <CaretDown
            size={10}
            className={cn(
              'transition-transform duration-200 ease-out shrink-0',
              collapsed && '-rotate-90',
            )}
          />
          <span className="truncate">{name}</span>
        </button>

        {/* Right side: unread badge + add button */}
        <span className="flex items-center gap-1 shrink-0">
          <span
            className={cn(
              'min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center',
              'transition-all duration-200',
              collapsed && unreadCount > 0
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-75 w-0 min-w-0 overflow-hidden',
            )}
          >
            {unreadCount}
          </span>

          {onAddChannel && (
            <Plus
              size={14}
              className={cn(
                'text-muted-foreground transition-opacity duration-150 hover:text-foreground cursor-pointer',
                collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-0 group-hover:opacity-100',
              )}
              onClick={(e) => {
                e.stopPropagation();
                onAddChannel();
              }}
            />
          )}
        </span>
      </div>

      {/* Channel list with height animation */}
      <div
        ref={contentRef}
        className="overflow-hidden transition-[height,opacity] duration-200 ease-out"
        style={{
          height: collapsed ? 0 : contentHeight === 'auto' ? 'auto' : contentHeight,
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div className="space-y-px">
          {children}
        </div>
      </div>
    </div>
  );
}
