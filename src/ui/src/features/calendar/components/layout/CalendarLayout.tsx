import { type ReactNode, useState, useCallback } from "react";
import { Panel, Group } from "react-resizable-panels";
import { PaneSeparator } from "@/components/ui/pane-separator";
import { CalendarCheck, CalendarDots, Swatches, Tag } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { LAYOUT } from "@/features/calendar/constants";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Drawer } from "@/components/ui/drawer";
import { toggleSidebar } from "@/features/calendar/store";
import { EventDetailModal } from "@/features/calendar/components/detail/EventDetailModal";
import { cn } from "@/shared/utils/cn";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";

const CALENDAR_SECTIONS: SidebarSection[] = [
  { id: "quick-access", icon: CalendarCheck, label: "Quick Access" },
  { id: "mini-calendar", icon: CalendarDots, label: "Calendar" },
  { id: "categories", icon: Swatches, label: "Categories" },
  { id: "tags", icon: Tag, label: "Tags" },
];

interface CalendarLayoutProps {
  sidebar: ReactNode;
  mainContent: ReactNode;
}

export function CalendarLayout({ sidebar, mainContent }: CalendarLayoutProps) {
  const dispatch = useAppDispatch();
  const { isSidebarCollapsed, selectedEventId } = useAppSelector((state) => state.calendarUi);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [defaultLayout] = useState(() => loadPanelLayout("calendar"));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("calendar", layout);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    if (!isSidebarCollapsed) {
      dispatch(toggleSidebar());
    }
  }, [dispatch, isSidebarCollapsed]);

  const handleExpandSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const sidebarAsDrawer = isMobile;
  const showSidebar = !isZenMode && !isSidebarCollapsed;
  const showCollapsedRail = !isZenMode && isSidebarCollapsed && !sidebarAsDrawer;

  return (
    <div className="relative h-full bg-background overflow-hidden">
      {showCollapsedRail && (
        <div className="absolute inset-y-0 left-0 z-30 w-12">
          <CollapsibleSidebarRail onExpand={handleExpandSidebar} sections={CALENDAR_SECTIONS}>
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
        {showSidebar && !sidebarAsDrawer && (
          <>
            <Panel
              id="calendar-sidebar"
              defaultSize={isMobileOrTablet ? 200 : LAYOUT.SIDEBAR_WIDTH}
              minSize={160}
              maxSize={isMobileOrTablet ? 300 : LAYOUT.SIDEBAR_MAX_WIDTH}
              className="bg-nav overflow-hidden"
            >
              {sidebar}
            </Panel>

            <PaneSeparator />
          </>
        )}

        <Panel id="calendar-main" minSize={isMobileOrTablet ? 200 : 400}>
          <div className={cn("h-full overflow-hidden bg-surface", showCollapsedRail && "ml-12")}>
            {mainContent}
          </div>
        </Panel>
      </Group>

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

      {!isZenMode && selectedEventId && <EventDetailModal />}
    </div>
  );
}
