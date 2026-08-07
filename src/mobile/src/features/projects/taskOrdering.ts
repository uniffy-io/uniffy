import type { SerializedTask } from "@features/projects/projectsSerializer";

/** The gap the server leaves between appended tasks, so an insert has room to split it. */
export const SORT_STEP = 65536;

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

export interface TaskMove {
  taskId: string;
  status: string;
  sortOrder: number;
}

/**
 * `sort_order` is an int32 column, so an insert has to land on a whole number
 * strictly between its two neighbours. Returns null once no such number exists
 * and the column has to be respaced instead.
 */
export function sortOrderBetween(lower: number | null, upper: number | null): number | null {
  if (lower === null && upper === null) return SORT_STEP;

  if (lower === null) {
    const halved = Math.floor(upper! / 2);
    if (halved < upper!) return halved;
    return upper! - SORT_STEP >= INT32_MIN ? upper! - SORT_STEP : null;
  }

  if (upper === null) {
    return lower + SORT_STEP <= INT32_MAX ? lower + SORT_STEP : null;
  }

  const mid = Math.floor((lower + upper) / 2);
  return mid > lower && mid < upper ? mid : null;
}

/**
 * The writes that land `task` directly after `after` in its destination column.
 *
 * `destination` is every live task carrying that status, not just the ones on
 * screen: anchoring on the visible row above the drop and splitting against its
 * real successor keeps a drop made while a filter is on in the right place once
 * the filter comes off.
 */
export function planTaskMove(params: {
  task: SerializedTask;
  status: string;
  destination: SerializedTask[];
  after: SerializedTask | null;
}): TaskMove[] {
  const { task, status, after } = params;
  const destination = params.destination
    .filter((t) => t.id !== task.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const anchor = after ? destination.findIndex((t) => t.id === after.id) : -1;
  const lower = anchor >= 0 ? destination[anchor] : null;
  const upper = destination[anchor + 1] ?? null;

  const between = sortOrderBetween(lower?.sortOrder ?? null, upper?.sortOrder ?? null);
  if (between !== null) return [{ taskId: task.id, status, sortOrder: between }];

  // Repeated drops into the same gap eventually leave the neighbours on
  // adjacent numbers with nothing between them. Respace the whole column and
  // write back only the rows whose number actually moved.
  const respaced = [...destination];
  respaced.splice(anchor + 1, 0, task);
  return respaced
    .map((t, i) => ({ taskId: t.id, status, sortOrder: (i + 1) * SORT_STEP }))
    .filter((move, i) => move.taskId === task.id || respaced[i].sortOrder !== move.sortOrder);
}
