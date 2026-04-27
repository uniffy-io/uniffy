/**
 * CollapsibleSidebarRail - Collapsed sidebar icon rail with hover-to-expand overlay.
 *
 * When the sidebar is collapsed, renders a narrow icon rail (w-12) showing
 * section icons and an expand button. Hovering the rail reveals the full sidebar
 * content as an overlay that slides out from the left.
 *
 * Used by all domain layouts for consistent sidebar collapse behavior.
 */

import { type ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { CaretDoubleRight } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { SidebarOverlayContext } from '@/components/layout/SidebarOverlayContext';

export { SidebarOverlayContext } from '@/components/layout/SidebarOverlayContext';

export interface SidebarSection {
  id: string;
  icon: Icon;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}

interface CollapsibleSidebarRailProps {
  onExpand: () => void;
  sections: SidebarSection[];
  children: ReactNode;
}

export function CollapsibleSidebarRail({
  onExpand,
  sections,
  children,
}: CollapsibleSidebarRailProps) {
  return (
    <div className="group/sidebar h-full relative">
      {/* Icon rail - always visible */}
      <div className="h-full flex flex-col items-center pt-3 gap-0.5 bg-background border-r border-border">
        <button
          type="button"
          onClick={onExpand}
          className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors mb-1 cursor-pointer"
          title="Expand sidebar"
        >
          <CaretDoubleRight size={16} weight="bold" className="text-primary" />
        </button>

        {sections.map((section) => {
          const IconComponent = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              onClick={section.onClick}
              className={cn(
                'p-1.5 rounded-lg transition-colors cursor-pointer',
                section.isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              title={section.label}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-md">
                <IconComponent size={20} weight={section.isActive ? 'fill' : 'duotone'} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Full sidebar overlay on hover */}
      <div
        className={cn(
          'absolute inset-y-0 left-0 z-10',
          'w-0 group-hover/sidebar:w-72',
          'overflow-hidden',
          'transition-[width,box-shadow] duration-200 ease-out',
          'bg-background',
          'group-hover/sidebar:shadow-xl',
          'group-hover/sidebar:border-r group-hover/sidebar:border-border'
        )}
      >
        <div className="w-72 h-full overflow-hidden">
          <SidebarOverlayContext.Provider value={true}>
            {children}
          </SidebarOverlayContext.Provider>
        </div>
      </div>
    </div>
  );
}
