/**
 * TaskRedirectPage - Resolves a task ID to its project and redirects.
 *
 * Handles the route /projects/task/:taskId by fetching the task
 * from the API, reading its projectId, and navigating to
 * /projects/:projectId/tasks/:taskId.
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { PageLoader } from "@/components/feedback/PageLoader";
import { projectsApi } from "@/features/projects/api/projectsApi";

export function TaskRedirectPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!taskId || !orgId) return;

    projectsApi
      .getTask(taskId, orgId)
      .then((res) => {
        if (!res.task) return;
        navigate(`/projects/${res.task.projectId}/tasks/${res.task.id}`, {
          replace: true,
        });
      })
      .catch(() => {
        setError(true);
      });
  }, [taskId, orgId, navigate]);

  if (error) {
    return <Navigate to="/projects" replace />;
  }

  return <PageLoader />;
}
