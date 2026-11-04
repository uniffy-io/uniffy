export type TaskOpenView = "panel" | "modal" | "page";

export const DEFAULT_TASK_OPEN_VIEW: TaskOpenView = "modal";

export const TASK_OPEN_VIEWS: { value: TaskOpenView; label: string }[] = [
  { value: "panel", label: "Side panel" },
  { value: "modal", label: "Modal" },
  { value: "page", label: "Full page" },
];

export function parseTaskOpenView(value: unknown): TaskOpenView | undefined {
  return value === "panel" || value === "modal" || value === "page" ? value : undefined;
}

export function taskLinkPath(
  taskId: string,
  view?: TaskOpenView,
  projectView?: string | null,
): string {
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  if (projectView) params.set("projectView", projectView);
  const query = params.toString();
  return `/projects/task/${taskId}${query ? `?${query}` : ""}`;
}

export function taskProjectPath(projectId: string, projectView?: string | null): string {
  const params = new URLSearchParams();
  if (projectView) params.set("view", projectView);
  const query = params.toString();
  return `/projects/${projectId}${query ? `?${query}` : ""}`;
}

export function taskUrn(taskId: string): string {
  return `urn:uniffy:content:TASK:${taskId}`;
}
