import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Panel, Group, Separator } from "react-resizable-panels";
import {
  CaretDoubleLeft,
  Prohibit,
  TreeStructure,
  UsersThree,
  Warning,
} from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";
import { useShortcutHandler } from "@/features/settings";
import { AppHeader } from "@/components/layout/AppHeader";
import { Drawer } from "@/components/ui/drawer";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgChartCanvas } from "@/features/people/components/chart/OrgChartCanvas";
import { TeamPanel } from "@/features/people/components/chart/TeamPanel";
import { fetchOrgChartThunk, fetchProfilePolicyThunk } from "@/features/people/store/peopleThunks";

const PEOPLE_SECTIONS: SidebarSection[] = [{ id: "teams", icon: UsersThree, label: "Teams" }];

export function OrgChartPage() {
  const dispatch = useAppDispatch();
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const isZenMode = useAppSelector((s) => s.zenMode.isActive);
  const chart = useAppSelector((s) => s.people.chart);
  const policyStatus = useAppSelector((s) => s.people.policy.status);
  const { isOrgAdmin } = useAdminAccess();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTeamId = searchParams.get("team");

  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile);
  const [defaultLayout] = useState(() => loadPanelLayout("people-chart"));

  useDocumentTitle("People");

  useEffect(() => {
    dispatch(fetchOrgChartThunk());
    if (policyStatus === "idle") dispatch(fetchProfilePolicyThunk());
  }, [dispatch, policyStatus]);

  const handleSelectTeam = useCallback(
    (teamId: string | null) => {
      setSearchParams(
        (params) => {
          if (teamId) {
            params.set("team", teamId);
          } else {
            params.delete("team");
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  useShortcutHandler("app.toggleSidebar", handleToggleSidebar);

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("people-chart", layout);
  }, []);

  const showSidebar = sidebarOpen && !isZenMode;
  const sidebarAsDrawer = isMobile;
  const showCollapsedRail = !isZenMode && !showSidebar && !sidebarAsDrawer;

  const railPanel = (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-0.5 px-3 pb-2 pt-3">
        <UsersThree size={16} weight="duotone" className="ml-1 shrink-0 text-muted-foreground" />
        <span className="ml-1.5 text-sm font-semibold text-foreground">Teams</span>
        <div className="flex-1" />
        {!isMobile && (
          <button
            type="button"
            onClick={handleToggleSidebar}
            className="shrink-0 rounded-md bg-transparent p-1.5 transition-colors hover:bg-muted"
            title="Toggle sidebar"
          >
            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
          </button>
        )}
      </div>
      <TeamPanel teams={chart.teams} selectedTeamId={selectedTeamId} onSelect={handleSelectTeam} />
    </div>
  );

  const chartContent = (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <h1 className="text-sm font-semibold text-foreground">People</h1>
        {chart.truncated && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
            title="The reporting tree was truncated: a cycle was broken or the depth cap was hit."
          >
            <Warning size={10} weight="fill" />
            Truncated
          </span>
        )}
      </div>

      {chart.status === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md space-y-3 p-4">
            <Skeleton variant="rectangular" className="mx-auto h-14 w-56" />
            <div className="flex justify-center gap-6">
              <Skeleton variant="rectangular" className="h-14 w-56" />
              <Skeleton variant="rectangular" className="h-14 w-56" />
            </div>
          </div>
        </div>
      )}

      {chart.status === "succeeded" && !chart.enabled && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Prohibit size={48} weight="duotone" className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">The org chart is disabled</p>
          <p className="text-xs text-muted-foreground">
            An organization admin can enable it in the{" "}
            {isOrgAdmin ? (
              <Link to="/admin/people" className="text-primary hover:underline">
                admin settings
              </Link>
            ) : (
              "admin settings"
            )}
            .
          </p>
        </div>
      )}

      {chart.status === "succeeded" && chart.enabled && chart.nodes.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <TreeStructure size={48} weight="duotone" className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">No people yet</p>
        </div>
      )}

      {chart.status === "succeeded" && chart.enabled && chart.nodes.length > 0 && (
        <div className="min-h-0 flex-1">
          <OrgChartCanvas nodes={chart.nodes} teams={chart.teams} selectedTeamId={selectedTeamId} />
        </div>
      )}
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
            <CollapsibleSidebarRail onExpand={handleToggleSidebar} sections={PEOPLE_SECTIONS}>
              {railPanel}
            </CollapsibleSidebarRail>
          </div>
        )}

        <Group
          orientation="horizontal"
          className="flex h-full w-full"
          defaultLayout={defaultLayout}
          onLayoutChange={handleLayoutChange}
        >
          {showSidebar && !sidebarAsDrawer && (
            <>
              <Panel
                id="people-teams"
                defaultSize={isMobileOrTablet ? 220 : 260}
                minSize={180}
                maxSize={isMobileOrTablet ? 320 : 400}
                className="overflow-hidden bg-background"
              >
                {railPanel}
              </Panel>
              <Separator className="w-1 cursor-col-resize bg-border transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />
            </>
          )}

          <Panel
            id="people-chart"
            minSize={isMobileOrTablet ? 240 : 400}
            className={cn("overflow-hidden", showCollapsedRail && "ml-12")}
          >
            {chartContent}
          </Panel>
        </Group>

        {sidebarAsDrawer && (
          <Drawer
            open={showSidebar}
            onClose={handleToggleSidebar}
            side="left"
            className="w-72"
            ariaLabel="Teams"
          >
            {railPanel}
          </Drawer>
        )}
      </div>
    </>
  );
}
