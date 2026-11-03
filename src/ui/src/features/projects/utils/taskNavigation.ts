export interface TaskPageState {
  /** Task ids in the order the originating view showed them. */
  order?: string[];
  /** Path and query to return to with Back. */
  from?: string;
}

/** Browsers normalize backslashes and control characters before resolving origins. */
function isInAppPath(path: string): boolean {
  // eslint-disable-next-line no-control-regex
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f]/.test(path);
}

export function readTaskPageState(state: unknown): TaskPageState {
  if (!state || typeof state !== "object") return {};
  const { order, from } = state as Record<string, unknown>;
  return {
    order: Array.isArray(order) && order.every((id) => typeof id === "string") ? order : undefined,
    from: typeof from === "string" && isInAppPath(from) ? from : undefined,
  };
}

export function neighbours(
  order: readonly string[] | undefined,
  taskId: string,
): { prev: string | null; next: string | null } {
  const index = order ? order.indexOf(taskId) : -1;
  if (!order || index < 0) return { prev: null, next: null };
  return {
    prev: index > 0 ? order[index - 1] : null,
    next: index < order.length - 1 ? order[index + 1] : null,
  };
}

export interface TaskSelectionSync {
  key: string;
  settled: boolean;
}

export function reconcileTaskSelection(
  previous: TaskSelectionSync | null,
  key: string,
  taskId: string | undefined,
  selectedTaskId: string | null,
  detailOpen: boolean,
): { step: "sync" | "wait" | "ready"; state: TaskSelectionSync } {
  const matches = selectedTaskId === (taskId ?? null) && detailOpen === !!taskId;
  if (previous?.key !== key) {
    return { step: "sync", state: { key, settled: matches } };
  }
  if (!previous.settled && !matches) return { step: "wait", state: previous };
  return { step: "ready", state: { key, settled: true } };
}
