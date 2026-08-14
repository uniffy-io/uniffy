import { useEffect, useCallback, useState } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { Funnel } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import { AppHeader } from "@/components/layout/AppHeader";
import { Drawer } from "@/components/ui/drawer";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";
import { NotificationsPageHeader } from "@/features/notifications/components/NotificationsPageHeader";
import { NotificationsFilterSidebar } from "@/features/notifications/components/NotificationsFilterSidebar";
import { NotificationsListView } from "@/features/notifications/components/NotificationsListView";
import { NotificationsGroupedView } from "@/features/notifications/components/NotificationsGroupedView";
import { NotificationsAnalytics } from "@/features/notifications/components/NotificationsAnalytics";
import {
  searchPageNotifications,
  fetchPageNotificationStats,
  resetNotificationsPage,
  toggleFilterSidebar,
} from "@/features/notifications/store/notificationsPageSlice";

const NOTIFICATIONS_SECTIONS: SidebarSection[] = [
  { id: "filters", icon: Funnel, label: "Filters" },
];

export function NotificationsPage() {
  useDocumentTitle("Notifications");
  const dispatch = useAppDispatch();
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  const viewMode = useAppSelector((s) => s.notificationsPage.viewMode);
  const filterSidebarOpen = useAppSelector((s) => s.notificationsPage.filterSidebarOpen);
  const searchQuery = useAppSelector((s) => s.notificationsPage.searchQuery);
  const selectedTypes = useAppSelector((s) => s.notificationsPage.selectedTypes);
  const isReadFilter = useAppSelector((s) => s.notificationsPage.isReadFilter);
  const page = useAppSelector((s) => s.notificationsPage.page);
  const actorId = useAppSelector((s) => s.notificationsPage.actorId);
  const analyticsCollapsed = useAppSelector((s) => s.notificationsPage.analyticsCollapsed);
  const analyticsTimeRange = useAppSelector((s) => s.notificationsPage.analyticsTimeRange);

  const [defaultLayout] = useState(() => loadPanelLayout("notifications"));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("notifications", layout);
  }, []);

  const loadNotifications = useCallback(() => {
    dispatch(searchPageNotifications());
  }, [dispatch]);

  const dateFrom = useAppSelector((s) => s.notificationsPage.dateFrom);
  const dateTo = useAppSelector((s) => s.notificationsPage.dateTo);

  useEffect(() => {
    loadNotifications();
  }, [
    loadNotifications,
    searchQuery,
    selectedTypes,
    isReadFilter,
    page,
    actorId,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    dispatch(fetchPageNotificationStats());
  }, [dispatch, analyticsTimeRange]);

  useEffect(() => {
    return () => {
      dispatch(resetNotificationsPage());
    };
  }, [dispatch]);

  const showSidebar = filterSidebarOpen && !isZenMode;
  const sidebarAsDrawer = isMobile;
  const showCollapsedRail = !isZenMode && !showSidebar && !sidebarAsDrawer;

  const handleExpandSidebar = useCallback(() => {
    dispatch(toggleFilterSidebar());
  }, [dispatch]);

  const handleCloseSidebar = useCallback(() => {
    dispatch(toggleFilterSidebar());
  }, [dispatch]);

  useShortcutHandler("app.toggleSidebar", handleExpandSidebar);

  const contentArea = (
    <div className="flex flex-col h-full overflow-hidden">
      <NotificationsPageHeader />

      {!analyticsCollapsed && !isMobile && <NotificationsAnalytics />}

      <div className="flex-1 overflow-y-auto">
        {viewMode === "list" ? <NotificationsListView /> : <NotificationsGroupedView />}
      </div>
    </div>
  );

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "relative bg-background overflow-hidden transition-[height] duration-300 ease-in-out",
          isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
        )}
      >
        {showCollapsedRail && (
          <div className="absolute inset-y-0 left-0 z-30 w-12">
            <CollapsibleSidebarRail
              onExpand={handleExpandSidebar}
              sections={NOTIFICATIONS_SECTIONS}
            >
              <NotificationsFilterSidebar />
            </CollapsibleSidebarRail>
          </div>
        )}

        <Group
          orientation="horizontal"
          className="h-full w-full flex"
          defaultLayout={defaultLayout}
          onLayoutChange={handleLayoutChange}
        >
          {showSidebar && !sidebarAsDrawer && (
            <>
              <Panel
                id="notifications-sidebar"
                defaultSize={isMobileOrTablet ? 200 : 260}
                minSize={160}
                maxSize={isMobileOrTablet ? 300 : 400}
                className="bg-background overflow-hidden"
              >
                <NotificationsFilterSidebar />
              </Panel>
              <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
            </>
          )}

          <Panel id="notifications-content" minSize={isMobileOrTablet ? 200 : 400}>
            <div className={cn("h-full overflow-hidden bg-card", showCollapsedRail && "ml-12")}>
              {contentArea}
            </div>
          </Panel>
        </Group>

        {sidebarAsDrawer && (
          <Drawer
            open={showSidebar}
            onClose={handleCloseSidebar}
            side="left"
            className="w-72"
            ariaLabel="Notification filters"
          >
            <NotificationsFilterSidebar />
          </Drawer>
        )}
      </div>
    </>
  );
}
