import { useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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

export function ProjectsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get(VIEW_PARAM);

  const currentProject = useAppSelector(selectCurrentProject);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const isDetailPanelOpen = useAppSelector(selectIsDetailPanelOpen);
  const { canEdit } = useProjectPermission();

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

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  useEffect(() => {
    if (projectId) {
      dispatch(setCurrentProject(projectId));
    }
  }, [dispatch, projectId]);

  const currentProjectId = currentProject?.id;
  const projectViews = useAppSelector(selectProjectViews(currentProjectId ?? ""));
  const activeViewId = useAppSelector(selectActiveView(currentProjectId ?? ""))?.id ?? null;
  // The parameter value the view sync last settled on; a different one came from the URL itself.
  const settledViewParam = useRef<string | null>(null);

  useEffect(() => {
    // Until the routed project and its views are in the store, a deep-linked view cannot be told
    // apart from one the caller cannot see, so the parameter is left alone.
    if (!currentProjectId || currentProjectId !== projectId || projectViews.length === 0) return;
    const { step, settled } = nextViewParamStep({
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

  // Live refresh on project access changes (shared / flipped to OPEN_TO_ORG ->
  // refetch the list), on a task created in the open project (child_added ->
  // refetch that project's task board), and on a shared view change in the open
  // project (views_changed -> refetch that project).
  useContentAccessRefetch(
    ContentType.PROJECT,
    useCallback(
      (change) => {
        if (change.action === "views_changed") {
          if (change.contentId === currentProjectId) {
            dispatch(fetchProject(currentProjectId));
          }
          return;
        }
        if (change.action === "child_added") {
          if (change.contentId === currentProjectId) {
            loadProjectTasks(currentProjectId);
          }
          return;
        }
        dispatch(fetchProjects());
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
      <ProjectsLayout />
    </>
  );
}
