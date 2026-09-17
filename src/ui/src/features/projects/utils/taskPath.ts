/** Route that opens a task inside its project. */
export function taskPath(projectId: string, taskId: string): string {
  return `/projects/${projectId}/tasks/${taskId}`;
}
