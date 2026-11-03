/** Route that opens a task inside its project. */
export function taskPath(projectId: string, taskId: string): string {
  return `/projects/${projectId}/tasks/${taskId}`;
}

/** The task on a page of its own, opened from the panel, the create modal and new tabs. */
export function taskPagePath(taskId: string): string {
  return `/projects/task/${taskId}/page`;
}

/** The task's content URN, as mentions and the access request flow key it. */
export function taskUrn(taskId: string): string {
  return `urn:uniffy:content:TASK:${taskId}`;
}
