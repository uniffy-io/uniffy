import type { QueryClient } from "@tanstack/react-query";
import { isCurrentSession } from "@core/auth/sessionScope";
import type { SerializedProject, SerializedView } from "@features/projects/projectsSerializer";

export interface ProjectViewScope {
  userId: string;
  organizationId: string;
  generation: number;
}

export function projectQueryKey(
  organizationId: string | null,
  projectId: string | undefined,
  userId: string | undefined,
) {
  return ["project", organizationId, projectId, userId] as const;
}

export function storeProjectView(
  client: QueryClient,
  scope: ProjectViewScope,
  projectId: string,
  change: { view?: SerializedView; removedId?: string },
): void {
  if (!isCurrentSession(scope.generation)) return;
  const key = projectQueryKey(scope.organizationId, projectId, scope.userId);
  client.setQueryData<SerializedProject>(key, (project) => {
    if (!project) return project;
    const views = project.views.filter(
      (view) => view.id !== change.removedId && view.id !== change.view?.id,
    );
    return { ...project, views: change.view ? [...views, change.view] : views };
  });
  void client.invalidateQueries({ queryKey: key });
}
