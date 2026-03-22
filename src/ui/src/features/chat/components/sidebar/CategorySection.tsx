/**
 * CategorySection - Collapsible channel category in the sidebar.
 *
 * Shows a category header with name, collapse chevron, and "+" button.
 * When expanded, renders the channel list items with a smooth height animation.
 * When collapsed, shows aggregate unread count on the header.
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import {
  CaretDown,
  Plus,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface CategorySectionProps {
  name: string;
  defaultCollapsed?: boolean;
  unreadCount?: number;
  onAddChannel?: () => void;
  children: ReactNode;
}

export function CategorySection({
  name,
  defaultCollapsed = false,
  unreadCount = 0,
  onAddChannel,
  children,
}: CategorySectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto');

  // Measure content height for animation
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (!collapsed) {
      // Expanding: measure and set target height, then switch to auto after transition
      setContentHeight(el.scrollHeight);
      const timer = setTimeout(() => setContentHeight('auto'), 200);
      return () => clearTimeout(timer);
    } else {
      // Collapsing: set current height first (so transition starts from a real value)
      setContentHeight(el.scrollHeight);
      // Force reflow, then set to 0
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
    <div className="mt-1">
      {/* Category header */}
      <button
        onClick={handleToggle}
        className="flex items-center justify-between w-full px-3 py-1.5 group"
      >
        <span className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground">
          <CaretDown
            size={10}
            className={cn(
              'transition-transform duration-200 ease-out',
              collapsed && '-rotate-90',
            )}
          />
          {name}
        </span>

        <span className="flex items-center gap-1">
          {/* Aggregate unread badge when collapsed */}
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

          {/* Add channel button */}
          {onAddChannel && (
            <Plus
              size={14}
              className={cn(
                'text-muted-foreground transition-opacity duration-150 hover:text-foreground',
                collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-0 group-hover:opacity-100',
              )}
              onClick={(e) => {
                e.stopPropagation();
                onAddChannel();
              }}
            />
          )}
        </span>
      </button>

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
