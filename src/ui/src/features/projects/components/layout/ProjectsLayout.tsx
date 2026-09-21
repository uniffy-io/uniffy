import { useState, useCallback, useEffect } from "react";
import { Group, Panel } from "react-resizable-panels";
import { PaneSeparator } from "@/components/ui/pane-separator";
import { Kanban, SidebarSimple, SquaresFour, LockSimple, Buildings } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Drawer } from "@/components/ui/drawer";
import { LAYOUT } from "@/features/projects/constants";
import { ProjectsSidebar } from "@/features/projects/components/sidebar/ProjectsSidebar";
import { ProjectHeader } from "@/features/projects/components/header/ProjectHeader";
import { TableView } from "@/features/projects/components/views/table/TableView";
import { BoardView } from "@/features/projects/components/views/board/BoardView";
import { RoadmapView } from "@/features/projects/components/views/roadmap/RoadmapView";
import { BacklogView } from "@/features/projects/components/backlog/BacklogView";
import { DependencyGraphView } from "@/features/projects/components/views/graph/DependencyGraphView";
import { ResourceView } from "@/features/projects/components/views/resources/ResourceView";
import { TaskDetailModal } from "@/features/projects/components/detail/TaskDetailModal";
import { TaskDetailPanel } from "@/features/projects/components/detail/TaskDetailPanel";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { CreateTaskModal } from "@/features/projects/components/modals/CreateTaskModal";
import { CreateProjectModal } from "@/features/projects/components/modals/CreateProjectModal";
import { EditProjectModal } from "@/features/projects/components/modals/EditProjectModal";
import { fetchSprints } from "@/features/projects/store/sprintsThunks";
import { DIRECTORY_MEMBERS_PAGE_SIZE, fetchMembers } from "@/features/admin";
import {
  selectEditProjectId,
  selectIsDetailPanelOpen,
  selectDetailViewMode,
  selectIsSidebarOpen,
  selectSelectedTaskId,
  selectViewMode,
  toggleSidebar,
  closeDetailPanel,
  selectTask,
} from "@/features/projects/store/projectsUiSlice";
import { selectCurrentProject, selectProjects } from "@/features/projects/store/projectsSlice";
import { ProjectsEmptyState } from "@/features/projects/components/ProjectsEmptyState";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";

const PROJECTS_SECTIONS: SidebarSection[] = [
  { id: "all", icon: SquaresFour, label: "All Projects" },
  { id: "personal", icon: LockSimple, label: "Personal" },
  { id: "organization", icon: Buildings, label: "Organization" },
];

export function ProjectsLayout() {
  const dispatch = useAppDispatch();
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen);
  const isDetailPanelOpen = useAppSelector(selectIsDetailPanelOpen);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const viewMode = useAppSelector(selectViewMode);
  const currentProject = useAppSelector(selectCurrentProject);
  const currentProjectId = currentProject?.id;
  const isCreateTaskModalOpen = useAppSelector((state) => state.projectsUi.isCreateTaskModalOpen);
  const { canEdit: canEditProject } = useProjectPermission();
  const isCreateProjectModalOpen = useAppSelector(
    (state) => state.projectsUi.isCreateProjectModalOpen,
  );
  const editProjectId = useAppSelector(selectEditProjectId);

  // Fetch sprints whenever the current project changes
  useEffect(() => {
    if (currentProjectId) {
      dispatch(fetchSprints(currentProjectId));
    }
  }, [currentProjectId, dispatch]);

  // Load organization members for assignee display
  const membersFetched = useAppSelector((state) => state.admin.membersFetched);
  const membersLoading = useAppSelector((state) => state.admin.membersLoading);
  useEffect(() => {
    if (!membersFetched && !membersLoading) {
      dispatch(fetchMembers({ pageSize: DIRECTORY_MEMBERS_PAGE_SIZE }));
    }
  }, [dispatch, membersFetched, membersLoading]);

  // Load saved panel layout
  const [defaultLayout] = useState(() => loadPanelLayout("projects"));

  // Save layout changes
  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("projects", layout);
  }, []);

  const handleExpandSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  // Responsive panel mode
  const sidebarAsDrawer = isMobile;
  const detailViewMode = useAppSelector(selectDetailViewMode);
  // Use modal for mobile/tablet always, or when user prefers modal on desktop
  const useModalForDetail = isMobileOrTablet || detailViewMode === "modal";

  // Determine if we should show each panel
  const showSidebar = !isZenMode && isSidebarOpen;
  const showDetailPanel = !isZenMode && isDetailPanelOpen && selectedTaskId;
  const showCollapsedRail = !isZenMode && !isSidebarOpen && !sidebarAsDrawer;

  const handleCloseDetailPanel = () => {
    dispatch(closeDetailPanel());
    dispatch(selectTask(null));
  };

  return (
    <>
      <div
        className={cn(
          "relative flex flex-col bg-background text-foreground overflow-hidden",
          "transition-[height] duration-300 ease-in-out",
          isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
        )}
      >
        {/* Collapsed sidebar rail */}
        {showCollapsedRail && (
          <div className="absolute inset-y-0 left-0 z-30 w-12">
            <CollapsibleSidebarRail onExpand={handleExpandSidebar} sections={PROJECTS_SECTIONS}>
              <ProjectsSidebar />
            </CollapsibleSidebarRail>
          </div>
        )}

        <Group
          orientation="horizontal"
          className="h-full w-full flex"
          defaultLayout={defaultLayout}
          onLayoutChange={handleLayoutChange}
        >
          {/* Left Sidebar - inline on tablet/desktop */}
          {showSidebar && !sidebarAsDrawer && (
            <>
              <Panel
                id="projects-sidebar"
                defaultSize={isMobileOrTablet ? 200 : LAYOUT.SIDEBAR_WIDTH}
                minSize={LAYOUT.SIDEBAR_MIN_WIDTH}
                maxSize={LAYOUT.SIDEBAR_MAX_WIDTH}
                className="bg-nav"
              >
                <ProjectsSidebar />
              </Panel>

              <PaneSeparator />
            </>
          )}

          {/* Main Content */}
          <Panel
            id="projects-main"
            minSize={isMobileOrTablet ? 100 : 400}
            className="flex flex-col overflow-hidden"
          >
            {currentProject ? (
              <div
                className={cn(
                  "h-full overflow-hidden bg-surface flex flex-col",
                  showCollapsedRail && "ml-12",
                )}
              >
                <ProjectHeader project={currentProject} />
                <div className="flex-1 overflow-hidden">
                  {viewMode === "table" && <TableView />}
                  {viewMode === "board" && <BoardView />}
                  {viewMode === "roadmap" && <RoadmapView />}
                  {viewMode === "backlog" && <BacklogView />}
                  {viewMode === "graph" && <DependencyGraphView />}
                  {viewMode === "resources" && <ResourceView />}
                </div>
              </div>
            ) : (
              <div className={cn(showCollapsedRail && "ml-12")}>
                <NoProjectSelected />
              </div>
            )}
          </Panel>

          {/* Right Detail Panel - inline sidebar on desktop only when sidebar mode */}
          {showDetailPanel && !useModalForDetail && (
            <>
              <PaneSeparator />

              <Panel
                id="projects-detail"
                defaultSize={LAYOUT.DETAIL_PANEL_WIDTH}
                minSize={LAYOUT.DETAIL_PANEL_MIN_WIDTH}
                maxSize={LAYOUT.DETAIL_PANEL_MAX_WIDTH}
                className="bg-background"
              >
                <TaskDetailPanel taskId={selectedTaskId} />
              </Panel>
            </>
          )}
        </Group>
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarAsDrawer && (
        <Drawer
          open={showSidebar}
          onClose={() => dispatch(toggleSidebar())}
          side="left"
          className="w-72"
          ariaLabel="Projects sidebar"
        >
          <ProjectsSidebar />
        </Drawer>
      )}

      {/* Detail modal (modal mode on desktop, or always on mobile/tablet) */}
      {showDetailPanel && useModalForDetail && selectedTaskId && (
        <TaskDetailModal taskId={selectedTaskId} onClose={handleCloseDetailPanel} />
      )}

      {/* Modals */}
      {isCreateTaskModalOpen && canEditProject && <CreateTaskModal />}
      {isCreateProjectModalOpen && <CreateProjectModal />}
      {editProjectId && <EditProjectModal />}
    </>
  );
}

function NoProjectSelected() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen);
  const projects = useAppSelector(selectProjects);

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Mobile sidebar toggle when no project selected */}
      {isMobile && !isSidebarOpen && (
        <div className="px-3 py-2">
          <button
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Show sidebar"
          >
            <SidebarSimple size={16} className="text-primary" />
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <ProjectsEmptyState />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="mb-4 flex justify-center">
              <Kanban size={48} weight="duotone" className="text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No Project Selected</h2>
            <p className="text-sm text-muted-foreground">
              Select a project from the sidebar or create a new one to get started.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
