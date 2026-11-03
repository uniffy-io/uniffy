/** Router state a task view hands the full page, so it can walk the same list. */
export interface TaskPageState {
  /** Task ids in the order the originating view showed them. */
  order?: string[];
  /** Path and query to return to with Back. */
  from?: string;
}

/**
 * In-app paths only. "//host" is protocol-relative, and browsers read a backslash as a slash and
 * drop tabs and newlines, so "/\\host" or "/\t/host" would leave the origin too.
 */
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

/** The tasks before and after `taskId` in `order`, or null at either end or when it is absent. */
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
