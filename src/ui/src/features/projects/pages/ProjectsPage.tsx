import { useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandlers } from "@/features/settings";
import { AppHeader } from "@/components/layout/AppHeader";
import { ProjectsLayout } from "../components/layout/ProjectsLayout";
import { setCurrentProject, selectCurrentProject } from "../store/projectsSlice";
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
} from "../store/projectsUiSlice";
import { selectActiveView, selectProjectViews } from "../store/viewSelectors";
import { VIEW_PARAM, nextViewParamStep } from "@/features/projects/utils/viewLinks";
import { fetchProject, fetchProjects, fetchProjectTasks } from "../store/projectsThunks";
import { useProjectPermission } from "../hooks/useProjectPermissions";
import { useContentAccessRefetch } from "@/features/notifications/hooks/useContentAccessRefetch";
import { taskPath } from "@/features/projects/utils/taskPath";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { WrongOrganizationNotice } from "@/features/auth/components/WrongOrganizationNotice";
import { useContentOrganizationResolver } from "@/features/auth/hooks/useContentOrganizationResolver";
import { cn } from "@/shared/utils/cn";
import { buildUrn, UrnType } from "@/shared/utils/urn";

export function ProjectsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get(VIEW_PARAM);

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

  // Suppresses the URL->state effect immediately after a state->URL navigation.
  const isProgrammaticNav = useRef(false);

  useDocumentTitle(currentProject?.name || "Projects");

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
          next.set(VIEW_PARAM, step.viewId);
          return next;
        },
        { replace: true },
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
    if (isProgrammaticNav.current) {
      isProgrammaticNav.current = false;
      return;
    }
    if (taskId) {
      dispatch(selectTask(taskId));
      dispatch(openDetailPanel());
    } else {
      dispatch(selectTask(null));
      dispatch(closeDetailPanel());
    }
  }, [dispatch, taskId]);

  useEffect(() => {
    const openProjectId = currentProject?.id;
    if (!openProjectId) return;
    // On arrival the store still names the previously open project; rewriting the URL from it
    // would move a task deep link into the wrong project. The route wins until the store follows.
    if (projectId && projectId !== openProjectId) return;

    if (selectedTaskId && isDetailPanelOpen) {
      if (taskId !== selectedTaskId) {
        isProgrammaticNav.current = true;
        navigate(
          { pathname: taskPath(openProjectId, selectedTaskId), search: window.location.search },
          { replace: true },
        );
      }
    } else if (taskId) {
      isProgrammaticNav.current = true;
      navigate(
        { pathname: `/projects/${openProjectId}`, search: window.location.search },
        { replace: true },
      );
    }
  }, [selectedTaskId, isDetailPanelOpen, currentProject?.id, projectId, taskId, navigate]);

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
        <ProjectsLayout />
      )}
    </>
  );
}
