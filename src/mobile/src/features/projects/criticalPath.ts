export interface CriticalPathResult {
  pathNodeIds: Set<string>;
  /** Edge keys formatted "fromId->toId". */
  pathEdges: Set<string>;
  pathLength: number;
  /** Reachable-descendants count per active node. */
  downstreamCounts: Map<string, number>;
}

const EMPTY_RESULT: CriticalPathResult = {
  pathNodeIds: new Set(),
  pathEdges: new Set(),
  pathLength: 0,
  downstreamCounts: new Map(),
};

/** Longest active dependency chain through the DAG; completed tasks are excluded. */
export function computeCriticalPath(
  nodeIds: string[],
  edges: { fromId: string; toId: string }[],
  completedIds: Set<string>,
): CriticalPathResult {
  const activeIds = new Set(nodeIds.filter((id) => !completedIds.has(id)));
  if (activeIds.size === 0) return EMPTY_RESULT;

  const activeEdges = edges.filter((e) => activeIds.has(e.fromId) && activeIds.has(e.toId));
  if (activeEdges.length === 0) return EMPTY_RESULT;

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const id of activeIds) {
    forward.set(id, []);
    backward.set(id, []);
  }
  for (const e of activeEdges) {
    forward.get(e.fromId)!.push(e.toId);
    backward.get(e.toId)!.push(e.fromId);
  }

  // Longest path from any root via iterative relaxation; bounded by node count.
  const depth = new Map<string, number>();
  for (const id of activeIds) depth.set(id, 0);

  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (const e of activeEdges) {
      const fromDepth = depth.get(e.fromId)!;
      if (depth.get(e.toId)! <= fromDepth) {
        depth.set(e.toId, fromDepth + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  let maxDepth = 0;
  let endNodeId: string | null = null;
  for (const [id, d] of depth) {
    if (d > maxDepth || (d === maxDepth && endNodeId === null)) {
      maxDepth = d;
      endNodeId = id;
    }
  }
  if (!endNodeId || maxDepth === 0) return EMPTY_RESULT;

  const pathNodeIds = new Set<string>();
  const pathEdges = new Set<string>();
  let currentId: string | null = endNodeId;

  while (currentId) {
    pathNodeIds.add(currentId);
    const currentDepth = depth.get(currentId)!;
    if (currentDepth === 0) break;

    const predecessors: string[] = backward.get(currentId) ?? [];
    let nextId: string | null = null;
    for (const predId of predecessors) {
      if (depth.get(predId) === currentDepth - 1) {
        nextId = predId;
        break;
      }
    }
    if (!nextId) break;

    pathEdges.add(`${nextId}->${currentId}`);
    currentId = nextId;
  }

  // Every edge runs from a lower depth to a higher one, so walking the nodes in
  // decreasing depth means a node's children are already resolved when it is
  // reached: one pass unioning child sets, rather than a fresh search per node.
  const byDepthDesc = [...activeIds].sort((a, b) => depth.get(b)! - depth.get(a)!);
  const descendants = new Map<string, Set<string>>();
  for (const id of byDepthDesc) {
    const reachable = new Set<string>();
    for (const child of forward.get(id) ?? []) {
      reachable.add(child);
      for (const further of descendants.get(child) ?? []) reachable.add(further);
    }
    descendants.set(id, reachable);
  }

  const downstreamCounts = new Map<string, number>();
  for (const [id, reachable] of descendants) downstreamCounts.set(id, reachable.size);

  return { pathNodeIds, pathEdges, pathLength: pathNodeIds.size, downstreamCounts };
}
