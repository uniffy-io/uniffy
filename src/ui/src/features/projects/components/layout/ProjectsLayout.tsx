/**
 * ProjectsLayout - Main three-panel layout for the Projects feature
 *
 * Structure:
 * - Left sidebar (280px default): Project list, filters, navigation
 * - Main content (flexible): Table/Board/Roadmap views
 * - Right detail panel (400px): Task details (conditional)
 *
 * Supports:
 * - Zen Mode (full screen, hides sidebars)
 * - Resizable panels with localStorage persistence
 * - Responsive behavior
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Kanban } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { LAYOUT } from "../../constants";
import { ProjectsSidebar } from "../sidebar/ProjectsSidebar";
import { ProjectHeader } from "../header/ProjectHeader";
import { TableView } from "../views/table/TableView";
import { BoardView } from "../views/board/BoardView";
import { RoadmapView } from "../views/roadmap/RoadmapView";
import { BacklogView } from "../backlog/BacklogView";
import { DependencyGraphView } from "../views/graph/DependencyGraphView";
import { TaskDetailPanel } from "../detail/TaskDetailPanel";
import { CreateTaskModal } from "../modals/CreateTaskModal";
import { CreateProjectModal } from "../modals/CreateProjectModal";
import { EditProjectModal } from "../modals/EditProjectModal";
import { fetchSprints } from "../../store/sprintsThunks";
import { fetchMembers } from "@/features/admin";
import {
  selectEditProjectId,
  selectIsDetailPanelOpen,
  selectIsSidebarOpen,
  selectSelectedTaskId,
  selectViewMode,
} from "../../store/projectsUiSlice";
import { selectCurrentProject, selectTasksForProject } from "../../store/projectsSlice";

const EMPTY_TASKS: ReturnType<ReturnType<typeof selectTasksForProject>> = [];

export function ProjectsLayout() {
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen);
  const isDetailPanelOpen = useAppSelector(selectIsDetailPanelOpen);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const viewMode = useAppSelector(selectViewMode);
  const currentProject = useAppSelector(selectCurrentProject);
  const currentProjectId = currentProject?.id;
  const selectTasks = useMemo(
    () => currentProjectId ? selectTasksForProject(currentProjectId) : () => EMPTY_TASKS,
    [currentProjectId],
  );
  const tasks = useAppSelector(selectTasks);
  const isCreateTaskModalOpen = useAppSelector((state) => state.projectsUi.isCreateTaskModalOpen);
  const isCreateProjectModalOpen = useAppSelector((state) => state.projectsUi.isCreateProjectModalOpen);
  const editProjectId = useAppSelector(selectEditProjectId);

  // Fetch sprints whenever the current project changes
  useEffect(() => {
    if (currentProjectId) {
      dispatch(fetchSprints(currentProjectId));
    }
  }, [currentProjectId, dispatch]);

  // Load organization members for assignee display
  const adminMembers = useAppSelector((state) => state.admin.members);
  useEffect(() => {
    if (adminMembers.length === 0) {
      dispatch(fetchMembers({ pageSize: 50 }));
    }
  }, [dispatch, adminMembers.length]);

  // Load saved panel layout
  const [defaultLayout] = useState(() => loadPanelLayout("projects"));

  // Save layout changes
  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("projects", layout);
  }, []);

  // Determine if we should show each panel
  const showSidebar = !isZenMode && isSidebarOpen;
  const showDetailPanel = !isZenMode && isDetailPanelOpen && selectedTaskId;

  return (
    <>
    <div
      className={cn(
        "flex flex-col bg-background text-foreground overflow-hidden",
        "transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-screen delay-150" : "h-[calc(100vh-4rem)] delay-0"
      )}
    >
      <Group
        orientation="horizontal"
        className="h-full w-full flex"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {/* Left Sidebar */}
        {showSidebar && (
          <>
            <Panel
              id="projects-sidebar"
              defaultSize={LAYOUT.SIDEBAR_WIDTH}
              minSize={LAYOUT.SIDEBAR_MIN_WIDTH}
              maxSize={LAYOUT.SIDEBAR_MAX_WIDTH}
              className="bg-card border-r border-border"
            >
              <ProjectsSidebar />
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main Content */}
        <Panel
          id="projects-main"
          minSize={400}
          className="flex flex-col overflow-hidden"
        >
          {currentProject ? (
            <div className="h-full overflow-hidden bg-card flex flex-col">
              <ProjectHeader project={currentProject} taskCount={tasks.length} />
              <div className="flex-1 overflow-hidden">
                {viewMode === "table" && <TableView />}
                {viewMode === "board" && <BoardView />}
                {viewMode === "roadmap" && <RoadmapView />}
                {viewMode === "backlog" && <BacklogView />}
                {viewMode === "graph" && <DependencyGraphView />}
              </div>
            </div>
          ) : (
            <NoProjectSelected />
          )}
        </Panel>

        {/* Right Detail Panel */}
        {showDetailPanel && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />

            <Panel
              id="projects-detail"
              defaultSize={LAYOUT.DETAIL_PANEL_WIDTH}
              minSize={LAYOUT.DETAIL_PANEL_MIN_WIDTH}
              maxSize={LAYOUT.DETAIL_PANEL_MAX_WIDTH}
              className="bg-card border-l border-border"
            >
              <TaskDetailPanel taskId={selectedTaskId} />
            </Panel>
          </>
        )}
      </Group>
    </div>

    {/* Modals */}
    {isCreateTaskModalOpen && <CreateTaskModal />}
    {isCreateProjectModalOpen && <CreateProjectModal />}
    {editProjectId && <EditProjectModal />}
    </>
  );
}

/**
 * Placeholder when no project is selected
 */
function NoProjectSelected() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background">
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
  );
}
