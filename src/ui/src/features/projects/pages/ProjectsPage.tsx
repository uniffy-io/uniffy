import { useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
} from "../store/projectsUiSlice";
import { fetchProjects, fetchProjectTasks } from "../store/projectsThunks";
import { useProjectPermission } from "../hooks/useProjectPermissions";
import { useContentAccessRefetch } from "@/features/notifications/hooks/useContentAccessRefetch";
import { taskPath } from "@/features/projects/utils/taskPath";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";

export function ProjectsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>();

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
  // refetch the list) and on a task created in the open project (child_added ->
  // refetch that project's task board).
  useContentAccessRefetch(
    ContentType.PROJECT,
    useCallback(
      (change) => {
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
        navigate(taskPath(openProjectId, selectedTaskId), { replace: true });
      }
    } else if (taskId) {
      isProgrammaticNav.current = true;
      navigate(`/projects/${openProjectId}`, { replace: true });
    }
  }, [selectedTaskId, isDetailPanelOpen, currentProject?.id, projectId, taskId, navigate]);

  return (
    <>
      <AppHeader />
      <ProjectsLayout />
    </>
  );
}
