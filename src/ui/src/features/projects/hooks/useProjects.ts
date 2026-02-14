import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectProjects,
  selectCurrentProject,
  selectProjectsLoading,
  selectProjectsErrors,
} from "../store/projectsSlice";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
} from "../store/projectsThunks";
import type { CreateProjectRequest, UpdateProjectRequest } from "../types/project";

/**
 * Hook for managing projects
 */
export function useProjects() {
  const dispatch = useAppDispatch();

  const projects = useAppSelector(selectProjects);
  const currentProject = useAppSelector(selectCurrentProject);
  const loading = useAppSelector(selectProjectsLoading);
  const errors = useAppSelector(selectProjectsErrors);

  const loadProjects = useCallback(() => {
    return dispatch(fetchProjects());
  }, [dispatch]);

  const addProject = useCallback(
    (data: CreateProjectRequest) => {
      return dispatch(createProject(data));
    },
    [dispatch]
  );

  const editProject = useCallback(
    (data: UpdateProjectRequest) => {
      return dispatch(updateProject(data));
    },
    [dispatch]
  );

  const removeProject = useCallback(
    (id: string) => {
      return dispatch(deleteProject(id));
    },
    [dispatch]
  );

  return {
    projects,
    currentProject,
    loading,
    errors,
    loadProjects,
    addProject,
    editProject,
    removeProject,
  };
}
