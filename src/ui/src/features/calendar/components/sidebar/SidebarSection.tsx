/**
 * SidebarSection - Reusable collapsible section for sidebar
 */

import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { toggleSectionCollapse } from '../../store';
import type { SidebarSectionId } from '../../types';
import { cn } from '@/utils/cn';
import type { ReactNode } from 'react';

interface SidebarSectionProps {
  id: SidebarSectionId;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function SidebarSection({
  id,
  title,
  children,
  action,
}: SidebarSectionProps) {
  const dispatch = useAppDispatch();
  const collapsedSections = useAppSelector(
    (state) => state.calendarUi.collapsedSections
  );

  const isCollapsed = collapsedSections.includes(id);

  const handleToggle = () => {
    dispatch(toggleSectionCollapse(id));
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleToggle}
          className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <span>{title}</span>
          <ChevronDownIcon
            className={cn(
              'w-3 h-3 transition-transform',
              isCollapsed && '-rotate-90'
            )}
          />
        </button>
        {action}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}
