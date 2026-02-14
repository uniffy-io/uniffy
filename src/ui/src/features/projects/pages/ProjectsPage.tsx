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
  selectSelectedTaskId,
  selectSelectedTaskIds,
  selectIsDetailPanelOpen,
} from "../store/projectsUiSlice";
import { fetchProjects, fetchProjectTasks } from "../store/projectsThunks";

/**
 * Main Projects page component
 *
 * Handles:
 * - URL parameter parsing (projectId, taskId)
 * - Document title updates
 * - Keyboard shortcuts
 * - Initial data loading
 */
export function ProjectsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>();

  // Get current project for document title
  const currentProject = useAppSelector(selectCurrentProject);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const isDetailPanelOpen = useAppSelector(selectIsDetailPanelOpen);

  // Guard to prevent URL-to-state effect from running after programmatic navigation
  const isProgrammaticNav = useRef(false);

  // Set document title
  useDocumentTitle(currentProject?.name || "Projects");

  // Register keyboard shortcuts
  useShortcutHandlers({
    "projects.newTask": () => {
      if (currentProject) {
        dispatch(openCreateTaskModal());
      }
    },
    "projects.newProject": () => {
      dispatch(openCreateProjectModal());
    },
  });

  // Load projects on mount
  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  // Handle project selection from URL
  useEffect(() => {
    if (projectId) {
      dispatch(setCurrentProject(projectId));
    }
  }, [dispatch, projectId]);

  // Fetch tasks whenever the current project changes
  useEffect(() => {
    if (currentProject) {
      dispatch(fetchProjectTasks(currentProject.id));
    }
  }, [dispatch, currentProject?.id]);

  // Handle task selection from URL (URL -> state)
  useEffect(() => {
    // Skip when URL was changed by our own state-to-URL effect
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

  // Sync state -> URL when task selection changes
  useEffect(() => {
    const currentProjectId = currentProject?.id;
    if (!currentProjectId) return;

    // Don't sync URL during multi-selection (URL represents single-task viewing)
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
