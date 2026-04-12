/**
 * ProjectSettingsPage - Dedicated page for project configuration
 *
 * Route: /projects/:projectId/settings
 * Sections: General, Statuses, Custom Fields, Task Types, Danger Zone
 */

import { useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { selectProjectById, setCurrentProject } from "@/features/projects/store/projectsSlice";
import { fetchProject, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { ProjectSettingsLayout } from "@/features/projects/components/settings/ProjectSettingsLayout";

export function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const selectProject = useMemo(() => selectProjectById(projectId || ""), [projectId]);
  const project = useAppSelector(selectProject);
  const { canManage } = useProjectPermission();

  useDocumentTitle(project ? `${project.name} Settings` : "Project Settings");

  // Ensure current project is set and data is loaded
  useEffect(() => {
    if (!projectId) return;
    dispatch(setCurrentProject(projectId));
    if (!project) {
      dispatch(fetchProject(projectId));
      dispatch(fetchProjectTasks(projectId));
    }
  }, [projectId, project, dispatch]);

  // Redirect if no settings permission (owner, org admin, domain admin, system admin)
  useEffect(() => {
    if (project && !canManage) {
      navigate(`/projects/${projectId}`, { replace: true });
    }
  }, [project, canManage, projectId, navigate]);

  if (!projectId) {
    navigate("/projects", { replace: true });
    return null;
  }

  if (!project) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-4 w-64 bg-muted rounded" />
        <div className="h-64 bg-muted rounded-lg" />
      </div>
    );
  }

  return <ProjectSettingsLayout project={project} />;
}
