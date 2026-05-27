import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandlers } from "@/features/settings";
import { AppHeader } from "@/components/layout/AppHeader";
import { ProjectsLayout } from "../components/layout/ProjectsLayout";
import {
  setCurrentProject,
  selectCurrentProject,
} from "../store/projectsSlice";
import {
  selectTask,
  openDetailPanel,
  closeDetailPanel,
  openCreateTaskModal,
  openCreateProjectModal,
  toggleSidebar,
  selectSelectedTaskId,
  selectSelectedTaskIds,
  selectIsDetailPanelOpen,
} from "../store/projectsUiSlice";
import { fetchProjects, fetchProjectTasks } from "../store/projectsThunks";

export function ProjectsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>();

  const currentProject = useAppSelector(selectCurrentProject);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const isDetailPanelOpen = useAppSelector(selectIsDetailPanelOpen);

  // Suppresses the URL->state effect immediately after a state->URL navigation.
  const isProgrammaticNav = useRef(false);

  useDocumentTitle(currentProject?.name || "Projects");

  useShortcutHandlers({
    "app.toggleSidebar": () => {
      dispatch(toggleSidebar());
    },
    "projects.newTask": () => {
      if (currentProject) {
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
  useEffect(() => {
    if (currentProjectId) {
      dispatch(fetchProjectTasks(currentProjectId));
    }
  }, [dispatch, currentProjectId]);

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
    const currentProjectId = currentProject?.id;
    if (!currentProjectId) return;

    // URL represents single-task viewing; skip while multi-selecting.
    if (selectedTaskIds.length > 1) return;

    if (selectedTaskId && isDetailPanelOpen) {
      if (taskId !== selectedTaskId) {
        isProgrammaticNav.current = true;
        navigate(`/projects/${currentProjectId}/tasks/${selectedTaskId}`, { replace: true });
      }
    } else if (taskId) {
      isProgrammaticNav.current = true;
      navigate(`/projects/${currentProjectId}`, { replace: true });
    }
  }, [selectedTaskId, selectedTaskIds.length, isDetailPanelOpen, currentProject?.id, taskId, navigate]);

  return (
    <>
      <AppHeader />
      <ProjectsLayout />
    </>
  );
}
