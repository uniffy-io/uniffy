/**
 * CalendarLayout - Main three-panel layout for the Calendar feature
 *
 * Structure:
 * - Left sidebar (280px default): Navigation, calendars, categories
 * - Main content (flexible): Calendar grid
 * - Right detail panel (300px): Event details (conditional)
 */

import type { ReactNode } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { useAppSelector } from '@/app/hooks';
import { LAYOUT } from '../../constants';

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
  const { isSidebarCollapsed, isDetailPanelOpen, isMobileView } = useAppSelector(
    (state) => state.calendarUi
  );

  // Mobile layout - show one panel at a time
  if (isMobileView) {
    return (
      <div className="h-[calc(100vh-4rem)] bg-background overflow-hidden">
        <div className="h-full">
          {mainContent}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] bg-background overflow-hidden">
      <Group orientation="horizontal" className="h-full">
        {/* Left Sidebar */}
        {!isSidebarCollapsed && (
          <>
            <Panel
              id="calendar-sidebar"
              defaultSize={LAYOUT.SIDEBAR_WIDTH}
              minSize={LAYOUT.SIDEBAR_MIN_WIDTH}
              maxSize={LAYOUT.SIDEBAR_MAX_WIDTH}
              className="bg-card overflow-hidden"
            >
              {sidebar}
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main Calendar Content */}
        <Panel id="calendar-main" minSize={400}>
          <div className="h-full overflow-hidden bg-card">
            {mainContent}
          </div>
        </Panel>

        {/* Right Detail Panel */}
        {isDetailPanelOpen && detailPanel && (
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
    </div>
  );
}
