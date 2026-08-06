import { computeCriticalPath } from "@features/projects/criticalPath";
import type { CriticalPathResult } from "@features/projects/criticalPath";
import type { SerializedTask, SerializedSprint } from "@features/projects/projectsSerializer";

/**
 * Node geometry. Narrower and shorter than the web card because the whole graph
 * has to stay legible on a phone at a scale that still shows its shape.
 */
export const NODE_W = 200;
export const NODE_H = 92;
export const H_GAP = 64;
const V_GAP = 14;
const MARGIN = 28;

const GROUP_HEADER_H = 30;
const GROUP_PADDING = 14;
const GROUP_GAP = 26;

export type NodeState = "completed" | "blocker" | "blocked" | "free" | "neutral";

export interface LayoutNode {
  id: string;
  title: string;
  number: number;
  completed: boolean;
  statusId: string;
  priority: string;
  taskType: string;
  dueDate: string | null;
  assigneeIds: string[];
  isSubtask: boolean;
  x: number;
  y: number;
  state: NodeState;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  satisfied: boolean;
}

export interface SprintGroup {
  sprintId: string | null;
  label: string;
  status: string | null;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  containmentEdges: LayoutEdge[];
  groups: SprintGroup[];
  canvasWidth: number;
  canvasHeight: number;
  criticalPath: CriticalPathResult;
}

function computeNodeState(
  task: SerializedTask,
  blockerSet: Set<string>,
  tasksMap: Map<string, SerializedTask>,
): NodeState {
  if (task.completedAt) return "completed";
  if (task.blockedByTaskIds.some((bid) => !tasksMap.get(bid)?.completedAt)) return "blocked";
  if (blockerSet.has(task.id)) return "blocker";
  if (task.blockedByTaskIds.length > 0) return "free";
  return "neutral";
}

function layoutTaskGroup(
  groupTasks: SerializedTask[],
  allEdges: LayoutEdge[],
  containmentEdges: LayoutEdge[],
  tasksMap: Map<string, SerializedTask>,
  stateMap: Map<string, NodeState>,
  startX: number,
  startY: number,
): { nodes: LayoutNode[]; width: number; height: number } {
  if (groupTasks.length === 0) return { nodes: [], width: 0, height: 0 };

  const groupSet = new Set(groupTasks.map((t) => t.id));

  // Rank by longest path. Containment (parent -> child) joins dependency edges
  // here so a child always lands a column to the right of its parent; the
  // visual hierarchy reads left-to-right alongside the dependency flow.
  const rank: Record<string, number> = {};
  for (const t of groupTasks) rank[t.id] = 0;

  const rankingEdges = [...allEdges, ...containmentEdges].filter(
    (e) => groupSet.has(e.fromId) && groupSet.has(e.toId),
  );

  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (const e of rankingEdges) {
      if (rank[e.toId] <= rank[e.fromId]) {
        rank[e.toId] = rank[e.fromId] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byRank: Record<number, string[]> = {};
  for (const t of groupTasks) {
    const r = rank[t.id];
    if (!byRank[r]) byRank[r] = [];
    byRank[r].push(t.id);
  }
  for (const ids of Object.values(byRank)) {
    ids.sort((a, b) => (tasksMap.get(a)?.number ?? 0) - (tasksMap.get(b)?.number ?? 0));
  }

  const nodes: LayoutNode[] = [];
  let maxX = 0;
  let maxY = 0;

  for (const [rankStr, ids] of Object.entries(byRank)) {
    const x = startX + Number(rankStr) * (NODE_W + H_GAP);

    ids.forEach((id, idx) => {
      const t = tasksMap.get(id)!;
      const y = startY + idx * (NODE_H + V_GAP);

      nodes.push({
        id,
        title: t.title,
        number: t.number,
        completed: !!t.completedAt,
        statusId: t.status,
        priority: t.priority,
        taskType: t.taskType || "task",
        dueDate: t.dueDate,
        assigneeIds: t.assigneeIds,
        isSubtask: !!t.parentId,
        x,
        y,
        state: stateMap.get(id) ?? "neutral",
      });

      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    });
  }

  return { nodes, width: maxX - startX, height: maxY - startY };
}

export function buildGraphLayout(
  tasks: SerializedTask[],
  sprints: SerializedSprint[],
): GraphLayout | null {
  if (tasks.length === 0) return null;

  const tasksMap = new Map(tasks.map((t) => [t.id, t]));
  const graphSet = new Set(tasks.map((t) => t.id));

  const allEdges: LayoutEdge[] = [];
  const blockerSet = new Set<string>();
  for (const t of tasks) {
    for (const bid of t.blockedByTaskIds) {
      if (!graphSet.has(bid)) continue;
      blockerSet.add(bid);
      allEdges.push({ fromId: bid, toId: t.id, satisfied: !!tasksMap.get(bid)?.completedAt });
    }
  }

  // Parent -> child links. Kept separate from allEdges so they never feed the
  // critical path or count as dependencies; they only inform layout + render.
  const containmentEdges: LayoutEdge[] = [];
  for (const t of tasks) {
    if (t.parentId && graphSet.has(t.parentId)) {
      containmentEdges.push({ fromId: t.parentId, toId: t.id, satisfied: false });
    }
  }

  const stateMap = new Map<string, NodeState>();
  for (const t of tasks) stateMap.set(t.id, computeNodeState(t, blockerSet, tasksMap));

  const criticalPath = computeCriticalPath(
    tasks.map((t) => t.id),
    allEdges,
    new Set(tasks.filter((t) => t.completedAt).map((t) => t.id)),
  );

  if (sprints.length === 0) {
    const result = layoutTaskGroup(
      tasks,
      allEdges,
      containmentEdges,
      tasksMap,
      stateMap,
      MARGIN,
      MARGIN,
    );
    return {
      nodes: result.nodes,
      edges: allEdges,
      containmentEdges,
      groups: [],
      canvasWidth: result.width + MARGIN * 2,
      canvasHeight: result.height + MARGIN * 2,
      criticalPath,
    };
  }

  const orderedGroups: { sprintId: string | null; label: string; status: string | null }[] = [
    ...[
      ...sprints.filter((s) => s.status === "active"),
      ...sprints.filter((s) => s.status === "planned").sort((a, b) => a.sortOrder - b.sortOrder),
    ].map((s) => ({ sprintId: s.id, label: s.name, status: s.status })),
    { sprintId: null, label: "Backlog", status: null },
  ];

  const groupedSprintIds = new Set(
    orderedGroups.map((g) => g.sprintId).filter((id): id is string => id !== null),
  );

  const allNodes: LayoutNode[] = [];
  const groups: SprintGroup[] = [];
  let currentX = MARGIN;
  let maxCanvasHeight = 0;

  for (const group of orderedGroups) {
    // Backlog is the catch-all, not just the sprintless tasks: a task left in a
    // closed sprint has no group of its own and would otherwise vanish here.
    const groupTasks = tasks.filter((t) =>
      group.sprintId === null
        ? !t.sprintId || !groupedSprintIds.has(t.sprintId)
        : t.sprintId === group.sprintId,
    );
    if (groupTasks.length === 0) continue;

    const result = layoutTaskGroup(
      groupTasks,
      allEdges,
      containmentEdges,
      tasksMap,
      stateMap,
      currentX + GROUP_PADDING,
      MARGIN + GROUP_HEADER_H + GROUP_PADDING,
    );

    const groupWidth = Math.max(result.width + GROUP_PADDING * 2, 240);
    const groupHeight = GROUP_HEADER_H + result.height + GROUP_PADDING * 2;

    groups.push({
      sprintId: group.sprintId,
      label: group.label,
      status: group.status,
      bounds: { x: currentX, y: MARGIN, width: groupWidth, height: groupHeight },
    });

    allNodes.push(...result.nodes);
    maxCanvasHeight = Math.max(maxCanvasHeight, MARGIN + groupHeight + MARGIN);
    currentX += groupWidth + GROUP_GAP;
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    containmentEdges,
    groups,
    canvasWidth: currentX - GROUP_GAP + MARGIN,
    canvasHeight: Math.max(maxCanvasHeight, MARGIN * 2),
    criticalPath,
  };
}

/**
 * A cubic curve from one node's right edge to the next node's left edge, plus
 * the arrowhead that sits on its end.
 *
 * The control-point offset accounts for vertical distance as well as
 * horizontal, so a cross-group edge (large dy, small dx) still curves instead
 * of degenerating into a straight line. The arrowhead is drawn rather than
 * left to an SVG marker so its angle follows the curve's end tangent.
 */
export function edgeGeometry(from: LayoutNode, to: LayoutNode): { path: string; arrow: string } {
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const ex = to.x;
  const ey = to.y + NODE_H / 2;
  const dy = ey - sy;

  const cpOffset = Math.max(Math.abs(ex - sx) * 0.4, Math.abs(dy) * 0.25, H_GAP * 0.4);
  const cp1x = sx + cpOffset;
  const cp2x = ex - cpOffset;
  const cp2y = ey - dy * 0.2;

  const angle = Math.atan2(ey - cp2y, ex - cp2x);
  const size = 8;
  const spread = 0.42;
  const x1 = ex - size * Math.cos(angle - spread);
  const y1 = ey - size * Math.sin(angle - spread);
  const x2 = ex - size * Math.cos(angle + spread);
  const y2 = ey - size * Math.sin(angle + spread);

  return {
    path: `M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${cp2y}, ${ex} ${ey}`,
    arrow: `${ex},${ey} ${x1},${y1} ${x2},${y2}`,
  };
}
