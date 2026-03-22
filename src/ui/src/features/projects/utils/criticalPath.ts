/**
 * Critical path calculation for task dependency graphs.
 *
 * Finds the longest dependency chain (critical path) through a DAG.
 * Tasks on the critical path determine the minimum project duration -
 * any delay on these tasks delays the entire project.
 */

export interface CriticalPathResult {
  /** Task IDs on the critical path */
  pathNodeIds: Set<string>;
  /** Edge keys ("fromId->toId") on the critical path */
  pathEdges: Set<string>;
  /** Number of tasks in the longest chain */
  pathLength: number;
  /** Task ID to number of downstream dependents */
  downstreamCounts: Map<string, number>;
}

const EMPTY_RESULT: CriticalPathResult = {
  pathNodeIds: new Set(),
  pathEdges: new Set(),
  pathLength: 0,
  downstreamCounts: new Map(),
};

/**
 * Compute the critical path (longest dependency chain) through a DAG.
 *
 * Completed tasks are excluded from the active critical path.
 * When multiple paths have equal length, picks one deterministically.
 */
export function computeCriticalPath(
  nodeIds: string[],
  edges: Array<{ fromId: string; toId: string }>,
  completedIds: Set<string>,
): CriticalPathResult {
  // Filter to active (non-completed) nodes
  const activeIds = new Set(nodeIds.filter((id) => !completedIds.has(id)));
  if (activeIds.size === 0) return EMPTY_RESULT;

  // Filter edges to only those between active nodes
  const activeEdges = edges.filter(
    (e) => activeIds.has(e.fromId) && activeIds.has(e.toId)
  );

  if (activeEdges.length === 0) {
    // No edges = no chain, path length is 1 (any single task)
    return EMPTY_RESULT;
  }

  // Build adjacency lists
  const forward = new Map<string, string[]>(); // fromId -> toIds (who I block)
  const backward = new Map<string, string[]>(); // toId -> fromIds (who blocks me)

  for (const id of activeIds) {
    forward.set(id, []);
    backward.set(id, []);
  }

  for (const e of activeEdges) {
    forward.get(e.fromId)!.push(e.toId);
    backward.get(e.toId)!.push(e.fromId);
  }

  // Compute depth (longest path from any root to this node) via iterative relaxation
  const depth = new Map<string, number>();
  for (const id of activeIds) {
    depth.set(id, 0);
  }

  // Iterate until convergence (same approach as the layout ranking)
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (const e of activeEdges) {
      const fromDepth = depth.get(e.fromId)!;
      const toDepth = depth.get(e.toId)!;
      if (toDepth <= fromDepth) {
        depth.set(e.toId, fromDepth + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Find the node with maximum depth (end of the critical path)
  let maxDepth = 0;
  let endNodeId: string | null = null;
  for (const [id, d] of depth) {
    if (d > maxDepth || (d === maxDepth && endNodeId === null)) {
      maxDepth = d;
      endNodeId = id;
    }
  }

  if (!endNodeId || maxDepth === 0) return EMPTY_RESULT;

  // Trace back from the end node to build the critical path
  const pathNodeIds = new Set<string>();
  const pathEdges = new Set<string>();
  let currentId: string | null = endNodeId;

  while (currentId) {
    pathNodeIds.add(currentId);
    const currentDepth = depth.get(currentId)!;

    if (currentDepth === 0) break; // Reached a root

    // Find the predecessor with depth = currentDepth - 1
    const predecessors: string[] = backward.get(currentId) ?? [];
    let nextId: string | null = null;
    for (const predId of predecessors) {
      if (depth.get(predId) === currentDepth - 1) {
        nextId = predId;
        break;
      }
    }

    if (nextId) {
      pathEdges.add(`${nextId}->${currentId}`);
      currentId = nextId;
    } else {
      break;
    }
  }

  // Compute downstream counts (number of reachable descendants per node)
  const downstreamCounts = new Map<string, number>();
  for (const id of activeIds) {
    const visited = new Set<string>();
    const queue = [...(forward.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      for (const child of forward.get(next) ?? []) {
        if (!visited.has(child)) queue.push(child);
      }
    }
    downstreamCounts.set(id, visited.size);
  }

  return {
    pathNodeIds,
    pathEdges,
    pathLength: pathNodeIds.size,
    downstreamCounts,
  };
}
