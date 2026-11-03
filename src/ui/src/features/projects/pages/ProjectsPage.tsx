import { useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandlers } from "@/features/settings";
import { AppHeader } from "@/components/layout/AppHeader";
import { ProjectsLayout } from "@/features/projects/components/layout/ProjectsLayout";
import { setCurrentProject, selectCurrentProject } from "@/features/projects/store/projectsSlice";
import {
  selectTask,
  openDetailPanel,
  closeDetailPanel,
  openCreateTaskModal,
  openCreateProjectModal,
  toggleSidebar,
  selectSelectedTaskId,
  selectIsDetailPanelOpen,
  openView,
  selectTaskNavigationOrder,
} from "@/features/projects/store/projectsUiSlice";
import { selectActiveView, selectProjectViews } from "@/features/projects/store/viewSelectors";
import { VIEW_PARAM, nextViewParamStep } from "@/features/projects/utils/viewLinks";
import {
  fetchProject,
  fetchProjects,
  fetchProjectTasks,
} from "@/features/projects/store/projectsThunks";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { useContentAccessRefetch } from "@/features/notifications/hooks/useContentAccessRefetch";
import {
  taskLinkPath,
  taskProjectPath,
  type TaskOpenView,
} from "@/features/projects/utils/taskPath";
import {
  readTaskPageState,
  reconcileTaskSelection,
  type TaskSelectionSync,
} from "@/features/projects/utils/taskNavigation";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { WrongOrganizationNotice } from "@/features/auth/components/WrongOrganizationNotice";
import { useContentOrganizationResolver } from "@/features/auth/hooks/useContentOrganizationResolver";
import { cn } from "@/shared/utils/cn";
import { buildUrn, UrnType } from "@/shared/utils/urn";

interface ProjectsWorkspaceProps {
  taskRoute?: { projectId: string; taskId: string; view: TaskOpenView };
}

export function ProjectsPage() {
  const currentProject = useAppSelector(selectCurrentProject);
  useDocumentTitle(currentProject?.name || "Projects");
  return <ProjectsWorkspace />;
}

export function ProjectsWorkspace({ taskRoute }: ProjectsWorkspaceProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const routeParams = useParams<{ projectId?: string }>();
  const projectId = taskRoute?.projectId ?? routeParams.projectId;
  const taskId = taskRoute?.taskId;
  const [searchParams, setSearchParams] = useSearchParams();
  const projectViewParam = taskRoute ? "projectView" : VIEW_PARAM;
  const viewParam = searchParams.get(projectViewParam);
  const { taskOpenView } = useAppearanceSettings();
  const settingsInitialized = useAppSelector((state) => state.settings.initialized);
  const navigationOrder = useAppSelector(selectTaskNavigationOrder);

  const currentProject = useAppSelector(selectCurrentProject);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const isDetailPanelOpen = useAppSelector(selectIsDetailPanelOpen);
  const { canEdit } = useProjectPermission();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  // The routed project is missing from a settled list, or the list itself failed to load. Either
  // way another organization of the user may hold it.
  const projectLoadFailed = useAppSelector((state) => {
    const { projects, projectsListed, errors } = state.projects;
    if (!projectId || projects[projectId]) return false;
    return projectsListed || errors.projects !== null;
  });
  const projectUrn = projectId ? buildUrn(UrnType.PROJECT, projectId) : null;
  const { match: projectOrganization } = useContentOrganizationResolver(
    projectUrn,
    projectLoadFailed,
  );

  const syncedRoute = useRef<TaskSelectionSync | null>(null);

  useShortcutHandlers({
    "app.toggleSidebar": () => {
      dispatch(toggleSidebar());
    },
    "projects.newTask": () => {
      if (currentProject && canEdit) {
        dispatch(openCreateTaskModal());
      }
    },
    "projects.newProject": () => {
      dispatch(openCreateProjectModal());
    },
  });

  // A switch into another organization from this route resets the slice, so both run again.
  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch, organizationId]);

  useEffect(() => {
    if (projectId) {
      dispatch(setCurrentProject(projectId));
    }
  }, [dispatch, projectId, organizationId]);

  const currentProjectId = currentProject?.id;
  const projectViews = useAppSelector(selectProjectViews(currentProjectId ?? ""));
  const activeViewId = useAppSelector(selectActiveView(currentProjectId ?? ""))?.id ?? null;
  const settledViewParam = useRef<ReturnType<typeof nextViewParamStep>["settled"] | null>(null);

  useEffect(() => {
    // Until the routed project and its views are in the store, a deep-linked view cannot be told
    // apart from one the caller cannot see, so the parameter is left alone.
    if (!currentProjectId || currentProjectId !== projectId || projectViews.length === 0) return;
    const { step, settled } = nextViewParamStep({
      projectId: currentProjectId,
      param: viewParam,
      settled: settledViewParam.current,
      activeViewId,
      viewIds: projectViews.map((view) => view.id),
    });
    settledViewParam.current = settled;
    if (step.kind === "open") {
      dispatch(openView({ projectId: currentProjectId, viewId: step.viewId }));
    } else if (step.kind === "write") {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          next.set(projectViewParam, step.viewId);
          return next;
        },
        { replace: true, state: location.state },
      );
    }
  }, [
    dispatch,
    setSearchParams,
    currentProjectId,
    projectId,
    projectViews,
    activeViewId,
    viewParam,
    projectViewParam,
    location.state,
  ]);
  // A project load spans several pages; a newer load or a project switch cancels the pending one.
  const tasksLoadRef = useRef<{ abort: () => void } | null>(null);
  const loadProjectTasks = useCallback(
    (id: string) => {
      tasksLoadRef.current?.abort();
      tasksLoadRef.current = dispatch(fetchProjectTasks(id));
    },
    [dispatch],
  );

  useEffect(() => {
    if (!currentProjectId) return;
    loadProjectTasks(currentProjectId);
    return () => tasksLoadRef.current?.abort();
  }, [loadProjectTasks, currentProjectId]);

  useContentAccessRefetch(
    ContentType.PROJECT,
    useCallback(
      (changes) => {
        if (
          currentProjectId &&
          changes.some(
            (change) => change.action === "views_changed" && change.contentId === currentProjectId,
          )
        ) {
          dispatch(fetchProject(currentProjectId));
        }
        if (
          currentProjectId &&
          changes.some(
            (change) => change.action === "child_added" && change.contentId === currentProjectId,
          )
        ) {
          loadProjectTasks(currentProjectId);
        }
        if (
          changes.some(
            (change) => change.action !== "views_changed" && change.action !== "child_added",
          )
        ) {
          dispatch(fetchProjects());
        }
      },
      [dispatch, currentProjectId, loadProjectTasks],
    ),
  );

  useEffect(() => {
    const route = `${organizationId}:${projectId ?? ""}:${taskId ?? ""}`;
    const { step, state } = reconcileTaskSelection(
      syncedRoute.current,
      route,
      taskId,
      selectedTaskId,
      isDetailPanelOpen,
    );
    syncedRoute.current = state;
    if (step === "sync") {
      dispatch(selectTask(taskId ?? null));
      dispatch(taskId ? openDetailPanel() : closeDetailPanel());
      return;
    }
    // Mount effects can repeat before Redux renders the route's selection.
    if (step === "wait") return;
    const openProjectId = currentProject?.id;
    if (!openProjectId) return;
    if (projectId && projectId !== openProjectId) return;
    const previous = readTaskPageState(location.state);
    if (selectedTaskId && isDetailPanelOpen) {
      if (taskId !== selectedTaskId) {
        navigate(
          taskLinkPath(
            selectedTaskId,
            settingsInitialized ? taskOpenView : undefined,
            viewParam ?? activeViewId,
          ),
          {
            state: {
              order: navigationOrder.includes(selectedTaskId) ? navigationOrder : undefined,
              from: taskId
                ? previous.from
                : taskProjectPath(openProjectId, viewParam ?? activeViewId),
            },
          },
        );
      }
    } else if (taskId) {
      navigate(previous.from ?? taskProjectPath(openProjectId, viewParam), { replace: true });
    }
  }, [
    dispatch,
    organizationId,
    selectedTaskId,
    isDetailPanelOpen,
    currentProject?.id,
    projectId,
    taskId,
    taskOpenView,
    settingsInitialized,
    viewParam,
    activeViewId,
    navigationOrder,
    location,
    navigate,
  ]);

  return (
    <>
      <AppHeader />
      {projectUrn && projectOrganization ? (
        <WrongOrganizationNotice
          urn={projectUrn}
          organization={projectOrganization}
          path={`${location.pathname}${location.search}`}
          onDismiss={() => navigate("/projects", { replace: true })}
          className={cn("bg-background", isZenMode ? "h-dvh" : "h-[calc(100dvh-3rem)]")}
        />
      ) : (
        <ProjectsLayout taskView={taskRoute?.view ?? taskOpenView} />
      )}
    </>
  );
}
