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
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { CaretDoubleRight } from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { LAYOUT } from '@/features/calendar/constants';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Drawer } from '@/components/ui/drawer';
import { toggleSidebar, closeDetailPanel } from '@/features/calendar/store';

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

  const sidebarAsDrawer = isMobile;
  const detailAsDrawer = isMobileOrTablet;
  const showSidebar = !isZenMode && !isSidebarCollapsed;

  return (
    <div className="h-full bg-background overflow-hidden">
      <Group
        orientation="horizontal"
        className="h-full"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {/* Collapsed sidebar toggle (shown when sidebar is hidden, not on mobile) */}
        {!showSidebar && !isMobile && (
          <div className="flex flex-col items-center py-3 px-1 bg-card border-r border-border">
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Show sidebar"
            >
              <CaretDoubleRight size={16} weight="bold" className="text-primary" />
            </button>
          </div>
        )}

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
          <div className="h-full overflow-hidden bg-card">
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
