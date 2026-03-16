/**
 * CalendarLayout - Main three-panel layout for the Calendar feature
 *
 * Structure:
 * - Left sidebar (280px default): Navigation, calendars, categories
 * - Main content (flexible): Calendar grid
 * - Right detail panel (300px): Event details (conditional)
 *
 * Responsive:
 * - Mobile: sidebar and detail panel as drawers, content full width
 * - Tablet: sidebar inline (narrower), detail panel as drawer
 * - Desktop: all panels inline and resizable
 *
 * Collapsed sidebar shows an icon rail with hover-to-expand overlay.
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import {
  CalendarCheck,
  CalendarDots,
  Swatches,
  Tag,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { LAYOUT } from '@/features/calendar/constants';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Drawer } from '@/components/ui/drawer';
import { toggleSidebar, closeDetailPanel } from '@/features/calendar/store';
import { cn } from '@/shared/utils/cn';
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from '@/components/layout/CollapsibleSidebarRail';

const CALENDAR_SECTIONS: SidebarSection[] = [
  { id: 'quick-access', icon: CalendarCheck, label: 'Quick Access' },
  { id: 'mini-calendar', icon: CalendarDots, label: 'Calendar' },
  { id: 'categories', icon: Swatches, label: 'Categories' },
  { id: 'tags', icon: Tag, label: 'Tags' },
];

interface CalendarLayoutProps {
  sidebar: ReactNode;
  mainContent: ReactNode;
  detailPanel?: ReactNode;
}

export function CalendarLayout({
  sidebar,
  mainContent,
  detailPanel,
}: CalendarLayoutProps) {
  const dispatch = useAppDispatch();
  const { isSidebarCollapsed, isDetailPanelOpen } = useAppSelector(
    (state) => state.calendarUi
  );
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [defaultLayout] = useState(() => loadPanelLayout('calendar'));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout('calendar', layout);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    if (!isSidebarCollapsed) {
      dispatch(toggleSidebar());
    }
  }, [dispatch, isSidebarCollapsed]);

  const handleCloseDetailPanel = useCallback(() => {
    dispatch(closeDetailPanel());
  }, [dispatch]);

  const handleExpandSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const sidebarAsDrawer = isMobile;
  const detailAsDrawer = isMobileOrTablet;
  const showSidebar = !isZenMode && !isSidebarCollapsed;
  const showCollapsedRail = !isZenMode && isSidebarCollapsed && !sidebarAsDrawer;

  return (
    <div className="relative h-full bg-background overflow-hidden">
      {/* Collapsed sidebar rail */}
      {showCollapsedRail && (
        <div className="absolute inset-y-0 left-0 z-30 w-12">
          <CollapsibleSidebarRail
            onExpand={handleExpandSidebar}
            sections={CALENDAR_SECTIONS}
          >
            {sidebar}
          </CollapsibleSidebarRail>
        </div>
      )}

      <Group
        orientation="horizontal"
        className="h-full"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {/* Left Sidebar - inline on tablet+, drawer on mobile */}
        {showSidebar && !sidebarAsDrawer && (
          <>
            <Panel
              id="calendar-sidebar"
              defaultSize={isMobileOrTablet ? 200 : LAYOUT.SIDEBAR_WIDTH}
              minSize={160}
              maxSize={isMobileOrTablet ? 300 : LAYOUT.SIDEBAR_MAX_WIDTH}
              className="bg-card overflow-hidden"
            >
              {sidebar}
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main Calendar Content */}
        <Panel id="calendar-main" minSize={isMobileOrTablet ? 200 : 400}>
          <div className={cn('h-full overflow-hidden bg-card', showCollapsedRail && 'ml-12')}>
            {mainContent}
          </div>
        </Panel>

        {/* Right Detail Panel - inline on desktop, drawer on tablet/mobile */}
        {!isZenMode && isDetailPanelOpen && detailPanel && !detailAsDrawer && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
            <Panel
              id="calendar-detail"
              defaultSize={LAYOUT.DETAIL_PANEL_WIDTH}
              minSize={LAYOUT.DETAIL_PANEL_MIN_WIDTH}
              maxSize={LAYOUT.DETAIL_PANEL_MAX_WIDTH}
              className="overflow-hidden"
            >
              <div className="h-full bg-card">
                {detailPanel}
              </div>
            </Panel>
          </>
        )}
      </Group>

      {/* Mobile sidebar drawer */}
      {sidebarAsDrawer && (
        <Drawer
          open={showSidebar}
          onClose={handleCloseSidebar}
          side="left"
          className="w-72"
          ariaLabel="Calendar sidebar"
        >
          {sidebar}
        </Drawer>
      )}

      {/* Tablet/mobile detail drawer */}
      {detailAsDrawer && (
        <Drawer
          open={!isZenMode && isDetailPanelOpen && !!detailPanel}
          onClose={handleCloseDetailPanel}
          side="right"
          className="w-80"
          showClose={false}
          ariaLabel="Event details"
        >
          {detailPanel}
        </Drawer>
      )}
    </div>
  );
}
