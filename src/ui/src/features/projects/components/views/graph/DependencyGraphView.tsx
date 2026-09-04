import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ShareNetwork,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowsIn,
  CalendarBlank,
  Lightning,
  TreeStructure,
  ArrowElbowDownRight,
} from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarStack } from "@/components/subject";
import { selectCurrentProject } from "@/features/projects/store/projectsSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import {
  selectTask,
  openDetailPanel,
  selectSelectedTaskId,
} from "@/features/projects/store/projectsUiSlice";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import type { Task, Sprint } from "@/features/projects/types";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { computeCriticalPath } from "@/features/projects/utils/criticalPath";
import type { CriticalPathResult } from "@/features/projects/utils/criticalPath";

const NODE_W = 280;
const NODE_H = 100;
const H_GAP = 100;
const V_GAP = 24;
const MARGIN = 48;

const GROUP_HEADER_H = 36;
const GROUP_PADDING = 24;
const GROUP_GAP = 40;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const ZOOM_SENSITIVITY = 0.002;

type NodeState = "completed" | "blocker" | "blocked" | "free" | "neutral";

interface LayoutNode {
  id: string;
  title: string;
  number: number;
  completedAt: string | null;
  statusId: string;
  taskType: string;
  sprintId: string | null;
  dueDate: string | null;
  assigneeIds: string[];
  parentId: string | null;
  rank: number;
  x: number;
  y: number;
  state: NodeState;
}

interface LayoutEdge {
  fromId: string;
  toId: string;
  satisfied: boolean;
}

interface SprintGroup {
  sprintId: string | null;
  label: string;
  status: string | null;
  bounds: { x: number; y: number; width: number; height: number };
}

interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  containmentEdges: LayoutEdge[];
  groups: SprintGroup[];
  canvasWidth: number;
  canvasHeight: number;
  criticalPath: CriticalPathResult;
}

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface PanState {
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  moved: boolean;
}

// Layout algorithm

function computeNodeState(
  task: Task,
  blockerSet: Set<string>,
  tasksMap: Map<string, Task>,
): NodeState {
  if (task.completedAt) return "completed";

  const hasPendingBlockers = task.blockedByTaskIds.some((bid) => !tasksMap.get(bid)?.completedAt);

  if (hasPendingBlockers) return "blocked";
  if (blockerSet.has(task.id)) return "blocker";
  if (task.blockedByTaskIds.length > 0) return "free";
  return "neutral";
}

function layoutTaskGroup(
  groupTasks: Task[],
  allEdges: LayoutEdge[],
  containmentEdges: LayoutEdge[],
  tasksMap: Map<string, Task>,
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

  // Group by rank
  const byRank: Record<number, string[]> = {};
  for (const t of groupTasks) {
    const r = rank[t.id];
    if (!byRank[r]) byRank[r] = [];
    byRank[r].push(t.id);
  }

  // Sort within each rank by number
  for (const ids of Object.values(byRank)) {
    ids.sort((a, b) => (tasksMap.get(a)?.number ?? 0) - (tasksMap.get(b)?.number ?? 0));
  }

  const nodes: LayoutNode[] = [];
  let maxX = 0;
  let maxY = 0;

  for (const [rankStr, ids] of Object.entries(byRank)) {
    const r = Number(rankStr);
    const x = startX + r * (NODE_W + H_GAP);

    ids.forEach((id, idx) => {
      const t = tasksMap.get(id)!;
      const y = startY + idx * (NODE_H + V_GAP);

      nodes.push({
        id,
        title: t.title,
        number: t.number,
        completedAt: t.completedAt,
        statusId: t.status,
        taskType: t.taskType || "task",
        sprintId: t.sprintId,
        dueDate: t.dueDate,
        assigneeIds: t.assigneeIds,
        parentId: t.parentId,
        rank: r,
        x,
        y,
        state: stateMap.get(id) ?? "neutral",
      });

      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    });
  }

  return {
    nodes,
    width: maxX - startX,
    height: maxY - startY,
  };
}

function buildGraphLayout(tasks: Task[], sprints: Sprint[]): GraphLayout | null {
  if (tasks.length === 0) return null;

  const tasksMap = new Map(tasks.map((t) => [t.id, t]));
  const graphSet = new Set(tasks.map((t) => t.id));

  // Build all edges
  const allEdges: LayoutEdge[] = [];
  const blockerSet = new Set<string>();
  for (const t of tasks) {
    for (const bid of t.blockedByTaskIds) {
      if (graphSet.has(bid)) {
        blockerSet.add(bid);
        allEdges.push({
          fromId: bid,
          toId: t.id,
          satisfied: !!tasksMap.get(bid)?.completedAt,
        });
      }
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

  // Compute states
  const stateMap = new Map<string, NodeState>();
  for (const t of tasks) {
    stateMap.set(t.id, computeNodeState(t, blockerSet, tasksMap));
  }

  // Compute critical path
  const completedIds = new Set(tasks.filter((t) => t.completedAt).map((t) => t.id));
  const critPath = computeCriticalPath(
    tasks.map((t) => t.id),
    allEdges,
    completedIds,
  );

  // No sprints: flat layout
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
      criticalPath: critPath,
    };
  }

  // Sprint mode: order groups
  const activeSprints = sprints.filter((s) => s.status === "active");
  const plannedSprints = sprints
    .filter((s) => s.status === "planned")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const orderedGroups: Array<{
    sprintId: string | null;
    label: string;
    status: string | null;
  }> = [
    ...activeSprints.map((s) => ({
      sprintId: s.id,
      label: s.name,
      status: s.status,
    })),
    ...plannedSprints.map((s) => ({
      sprintId: s.id,
      label: s.name,
      status: s.status,
    })),
    { sprintId: null, label: "Backlog", status: null },
  ];

  const allNodes: LayoutNode[] = [];
  const groups: SprintGroup[] = [];
  let currentX = MARGIN;
  let maxCanvasHeight = 0;

  for (const group of orderedGroups) {
    const groupTasks = tasks.filter((t) =>
      group.sprintId === null
        ? t.sprintId === null || t.sprintId === ""
        : t.sprintId === group.sprintId,
    );

    if (groupTasks.length === 0) continue;

    const contentStartX = currentX + GROUP_PADDING;
    const contentStartY = MARGIN + GROUP_HEADER_H + GROUP_PADDING;

    const result = layoutTaskGroup(
      groupTasks,
      allEdges,
      containmentEdges,
      tasksMap,
      stateMap,
      contentStartX,
      contentStartY,
    );

    const groupWidth = Math.max(result.width + GROUP_PADDING * 2, 300);
    const groupHeight = GROUP_HEADER_H + result.height + GROUP_PADDING * 2;

    groups.push({
      sprintId: group.sprintId,
      label: group.label,
      status: group.status,
      bounds: {
        x: currentX,
        y: MARGIN,
        width: groupWidth,
        height: groupHeight,
      },
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
    criticalPath: critPath,
  };
}

// Main component

export function DependencyGraphView() {
  const dispatch = useAppDispatch();
  const currentProject = useAppSelector(selectCurrentProject);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);

  const projectId = currentProject?.id;
  // Subtasks are first-class nodes here: a dependency graph that hides children
  // hides their blockers too. The "Top-level only" filter is the opt-in for a
  // root-only view.
  const tasks = useFilteredTasks(projectId ?? "", { includeSubtasks: true });
  const sprints = useAppSelector(selectSprintsForProject(currentProject?.id ?? ""));

  const statusOptions = useMemo(() => {
    const statusField = currentProject?.fieldDefinitions.find(
      (f) => f.id === SYSTEM_FIELD_IDS.STATUS,
    );
    const options = statusField?.config.options ?? [];
    const map: Record<string, { color: string; label: string }> = {};
    for (const opt of options) {
      map[opt.id] = { color: statusPaint(options, opt.id).solid, label: opt.label };
    }
    return map;
  }, [currentProject]);

  const layout = useMemo(() => buildGraphLayout(tasks, sprints), [tasks, sprints]);

  // Critical path toggle
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  // Parent/child links on by default; toggle off when the graph gets dense.
  const [showHierarchy, setShowHierarchy] = useState(true);

  // Pan/zoom state
  const [transform, setTransform] = useState<ViewTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<PanState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync transform to ref for the imperative wheel handler
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const prev = transformRef.current;

      const factor = 1 - e.deltaY * ZOOM_SENSITIVITY;
      const newScale = Math.min(Math.max(prev.scale * factor, MIN_ZOOM), MAX_ZOOM);

      // Zoom toward cursor
      const canvasX = (mouseX - prev.offsetX) / prev.scale;
      const canvasY = (mouseY - prev.offsetY) / prev.scale;
      const newOffsetX = mouseX - canvasX * newScale;
      const newOffsetY = mouseY - canvasY * newScale;

      setTransform({
        scale: newScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Pan handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startOffsetX: transform.offsetX,
        startOffsetY: transform.offsetY,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [transform.offsetX, transform.offsetY],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      if (!pan.moved) {
        pan.moved = true;
        setIsPanning(true);
      }
    }
    if (pan.moved) {
      setTransform((prev) => ({
        ...prev,
        offsetX: pan.startOffsetX + dx,
        offsetY: pan.startOffsetY + dy,
      }));
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

  const handleNodeClick = useCallback(
    (id: string) => {
      dispatch(selectTask(id));
      dispatch(openDetailPanel());
    },
    [dispatch],
  );

  // Zoom controls
  const zoomIn = useCallback(() => {
    setTransform((prev) => {
      const el = containerRef.current;
      if (!el) return prev;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newScale = Math.min(prev.scale * 1.25, MAX_ZOOM);
      const canvasX = (cx - prev.offsetX) / prev.scale;
      const canvasY = (cy - prev.offsetY) / prev.scale;
      return {
        scale: newScale,
        offsetX: cx - canvasX * newScale,
        offsetY: cy - canvasY * newScale,
      };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setTransform((prev) => {
      const el = containerRef.current;
      if (!el) return prev;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newScale = Math.max(prev.scale * 0.8, MIN_ZOOM);
      const canvasX = (cx - prev.offsetX) / prev.scale;
      const canvasY = (cy - prev.offsetY) / prev.scale;
      return {
        scale: newScale,
        offsetX: cx - canvasX * newScale,
        offsetY: cy - canvasY * newScale,
      };
    });
  }, []);

  const fitToScreen = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scaleX = cw / layout.canvasWidth;
    const scaleY = ch / layout.canvasHeight;
    const fitScale = Math.min(scaleX, scaleY, 1) * 0.9;
    setTransform({
      scale: fitScale,
      offsetX: (cw - layout.canvasWidth * fitScale) / 2,
      offsetY: (ch - layout.canvasHeight * fitScale) / 2,
    });
  }, [layout]);

  // Auto-fit on initial render and when layout changes
  const layoutIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!layout) return;
    // Build a lightweight identity from node count + canvas dimensions
    const id = `${layout.nodes.length}-${layout.canvasWidth}-${layout.canvasHeight}`;
    if (layoutIdRef.current !== id) {
      layoutIdRef.current = id;
      // Small delay to let the container measure its size
      requestAnimationFrame(() => fitToScreen());
    }
  }, [layout, fitToScreen]);

  // Empty state
  if (!layout) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <ShareNetwork size={48} weight="duotone" className="text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">No Tasks</h3>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Create tasks to visualize them and their dependency relationships here.
        </p>
      </div>
    );
  }

  const { nodes, edges, containmentEdges, groups, canvasWidth, canvasHeight, criticalPath } =
    layout;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-muted/30">
      {/* Legend bar */}
      <LegendBar
        showCriticalPath={showCriticalPath}
        onToggleCriticalPath={() => setShowCriticalPath(!showCriticalPath)}
        criticalPathLength={criticalPath.pathLength}
        showHierarchy={showHierarchy}
        onToggleHierarchy={() => setShowHierarchy(!showHierarchy)}
        hasHierarchy={containmentEdges.length > 0}
      />

      {/* Canvas area */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 relative overflow-hidden",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Transformed content */}
        <div
          style={{
            transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            position: "absolute",
            width: canvasWidth,
            height: canvasHeight,
          }}
        >
          {/* Sprint group regions */}
          {groups.map((group) => (
            <SprintGroupRegion key={group.sprintId ?? "__backlog__"} group={group} />
          ))}

          {/* SVG edge layer */}
          <svg
            className="absolute top-0 left-0 pointer-events-none"
            width={canvasWidth}
            height={canvasHeight}
            style={{ overflow: "visible" }}
          >
            <defs>
              <marker
                id="dg-arrow-active"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#ef4444" opacity="0.85" />
              </marker>
              <marker
                id="dg-arrow-done"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#22c55e" opacity="0.65" />
              </marker>
              <marker
                id="dg-arrow-critical"
                markerWidth="10"
                markerHeight="8"
                refX="9"
                refY="4"
                orient="auto"
              >
                <polygon points="0 0, 10 4, 0 8" fill="hsl(var(--primary))" opacity="1" />
              </marker>
              <marker
                id="dg-contain"
                markerWidth="9"
                markerHeight="9"
                refX="4.5"
                refY="4.5"
                orient="auto"
              >
                <polygon
                  points="0 4.5, 4.5 0, 9 4.5, 4.5 9"
                  fill="hsl(var(--muted-foreground))"
                  opacity="0.6"
                />
              </marker>
            </defs>

            {/* Containment links sit beneath dependency arrows, visually recessive */}
            {showHierarchy &&
              containmentEdges.map((edge) => {
                const fromNode = nodes.find((n) => n.id === edge.fromId);
                const toNode = nodes.find((n) => n.id === edge.toId);
                if (!fromNode || !toNode) return null;

                const sx = fromNode.x + NODE_W;
                const sy = fromNode.y + NODE_H / 2;
                const ex = toNode.x;
                const ey = toNode.y + NODE_H / 2;
                const absDx = Math.abs(ex - sx);
                const absDy = Math.abs(ey - sy);
                const dy = ey - sy;
                const cpOffset = Math.max(absDx * 0.4, absDy * 0.25, H_GAP * 0.4);
                const cp1x = sx + cpOffset;
                const cp2x = ex - cpOffset;
                const cp2y = ey - dy * 0.2;

                return (
                  <path
                    key={`contain-${edge.fromId}-${edge.toId}`}
                    d={`M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${cp2y}, ${ex} ${ey}`}
                    fill="none"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.25}
                    strokeDasharray="2 5"
                    opacity={0.45}
                    markerStart="url(#dg-contain)"
                  />
                );
              })}

            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.fromId);
              const toNode = nodes.find((n) => n.id === edge.toId);
              if (!fromNode || !toNode) return null;

              const sx = fromNode.x + NODE_W;
              const sy = fromNode.y + NODE_H / 2;
              const ex = toNode.x;
              const ey = toNode.y + NODE_H / 2;
              const absDx = Math.abs(ex - sx);
              const absDy = Math.abs(ey - sy);
              const edgeKey = `${edge.fromId}->${edge.toId}`;
              const isOnCritPath = showCriticalPath && criticalPath.pathEdges.has(edgeKey);
              const color = isOnCritPath
                ? "hsl(var(--primary))"
                : edge.satisfied
                  ? "#22c55e"
                  : "#ef4444";
              const opacity = isOnCritPath ? 1 : edge.satisfied ? 0.5 : 0.8;
              const markerId = isOnCritPath
                ? "dg-arrow-critical"
                : edge.satisfied
                  ? "dg-arrow-done"
                  : "dg-arrow-active";

              // Control point offset accounts for both horizontal and vertical
              // distance so cross-group edges (large dy, small dx) still curve
              // smoothly instead of degenerating into straight lines.
              const dy = ey - sy;
              const cpOffset = Math.max(absDx * 0.4, absDy * 0.25, H_GAP * 0.4);
              const cp1x = sx + cpOffset;
              const cp2x = ex - cpOffset;
              // Offset cp2 Y toward the source so the curve (and arrow
              // marker with orient="auto") arrives at the correct angle
              // instead of always entering horizontally.
              const cp2y = ey - dy * 0.2;

              return (
                <path
                  key={`${edge.fromId}-${edge.toId}`}
                  d={`M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${cp2y}, ${ex} ${ey}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={isOnCritPath ? 3 : 1.5}
                  strokeDasharray={isOnCritPath ? undefined : edge.satisfied ? "5 3" : undefined}
                  opacity={opacity}
                  markerEnd={`url(#${markerId})`}
                />
              );
            })}
          </svg>

          {/* HTML node layer */}
          {nodes.map((node) => {
            const status = statusOptions[node.statusId];
            return (
              <GraphNode
                key={node.id}
                node={node}
                projectSlug={currentProject?.slug ?? ""}
                statusColor={status?.color}
                statusLabel={status?.label}
                isSelected={node.id === selectedTaskId}
                isOnCriticalPath={showCriticalPath && criticalPath.pathNodeIds.has(node.id)}
                downstreamCount={criticalPath.downstreamCounts.get(node.id) ?? 0}
                onClick={handleNodeClick}
              />
            );
          })}
        </div>

        {/* Zoom controls (not transformed) */}
        <ZoomControls
          scale={transform.scale}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fitToScreen}
        />
      </div>
    </div>
  );
}

// GraphNode

const STATE_CLASSES: Record<NodeState, string> = {
  completed: "bg-muted/40 border-border text-muted-foreground",
  blocker: "bg-red-500/10 border-red-500/50 hover:bg-red-500/15",
  blocked: "bg-amber-500/10 border-amber-500/50 hover:bg-amber-500/15",
  free: "bg-green-500/10 border-green-500/50 hover:bg-green-500/15",
  neutral: "bg-card border-border hover:bg-muted",
};

const STATE_BADGE: Record<NodeState, { label: string; className: string } | null> = {
  completed: null,
  blocker: {
    label: "Blocker",
    className: "text-red-600 bg-red-500/10 border-red-500/30",
  },
  blocked: {
    label: "Blocked",
    className: "text-amber-600 bg-amber-500/10 border-amber-500/30",
  },
  free: {
    label: "Free",
    className: "text-green-600 bg-green-500/10 border-green-500/30",
  },
  neutral: null,
};

interface GraphNodeProps {
  node: LayoutNode;
  projectSlug: string;
  statusColor?: string;
  statusLabel?: string;
  isSelected: boolean;
  isOnCriticalPath: boolean;
  downstreamCount: number;
  onClick: (id: string) => void;
}

function GraphNode({
  node,
  projectSlug,
  statusColor,
  statusLabel,
  isSelected,
  isOnCriticalPath,
  downstreamCount,
  onClick,
}: GraphNodeProps) {
  const badge = STATE_BADGE[node.state];

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div
      className={cn(
        "absolute border rounded-lg cursor-pointer transition-colors select-none",
        STATE_CLASSES[node.state],
        isOnCriticalPath
          ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
          : isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: NODE_W,
        height: NODE_H,
        overflow: "visible",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onClick(node.id)}
    >
      {/* Critical path downstream impact badge */}
      {isOnCriticalPath && downstreamCount > 0 && (
        <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center z-10">
          {downstreamCount}
        </span>
      )}
      <div className="flex flex-col justify-between h-full p-2.5 overflow-hidden">
        {/* Top row: type icon + number + badge */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {node.parentId && (
              <ArrowElbowDownRight
                size={11}
                className="text-subtle-foreground shrink-0"
                aria-label="Subtask"
              />
            )}
            <TaskTypeIcon type={node.taskType} size={12} className="text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground leading-none whitespace-nowrap">
              {projectSlug}-{node.number}
            </span>
          </div>
          {badge && (
            <span
              className={cn(
                "shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap",
                badge.className,
              )}
            >
              {badge.label}
            </span>
          )}
        </div>

        {/* Title */}
        <p
          className={cn(
            "text-xs font-medium leading-snug line-clamp-2 flex-1 mt-1",
            node.state === "completed" && "line-through opacity-60",
          )}
        >
          {node.title}
        </p>

        {/* Bottom row: status + due date + assignees */}
        <div className="flex items-center justify-between gap-1.5 mt-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {statusColor && (
              <>
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: statusColor }}
                />
                <span className="text-[10px] text-muted-foreground truncate">{statusLabel}</span>
              </>
            )}
            {node.dueDate && (
              <>
                {statusColor && <span className="text-[10px] text-subtle-foreground">|</span>}
                <CalendarBlank size={10} className="text-muted-foreground shrink-0" />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatShortDate(node.dueDate)}
                </span>
              </>
            )}
          </div>
          {node.assigneeIds.length > 0 && (
            <SubjectAvatarStack
              subjectIds={node.assigneeIds}
              maxDisplay={3}
              size="xs"
              className="shrink-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Sprint group region

function SprintGroupRegion({ group }: { group: SprintGroup }) {
  const borderClass =
    group.status === "active" ? "border-primary/30 bg-primary/5" : "border-border bg-muted/10";

  return (
    <div
      className={cn("absolute rounded-xl border-2 border-dashed", borderClass)}
      style={{
        left: group.bounds.x,
        top: group.bounds.y,
        width: group.bounds.width,
        height: group.bounds.height,
      }}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        {group.status === "active" && <span className="w-2 h-2 rounded-full bg-primary" />}
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {group.label}
        </span>
        {group.status && (
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full",
              group.status === "active"
                ? "text-primary bg-primary/10"
                : "text-muted-foreground bg-muted",
            )}
          >
            {group.status}
          </span>
        )}
      </div>
    </div>
  );
}

// Zoom controls

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

function ZoomControls({ scale, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div
      className="absolute bottom-4 right-4 flex items-center gap-1 bg-card border border-border rounded-lg shadow-sm px-1 py-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onZoomOut}
        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Zoom out"
      >
        <MagnifyingGlassMinus size={16} />
      </button>
      <span className="text-xs text-muted-foreground font-mono w-10 text-center select-none">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Zoom in"
      >
        <MagnifyingGlassPlus size={16} />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        type="button"
        onClick={onFit}
        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Fit to screen"
      >
        <ArrowsIn size={16} />
      </button>
    </div>
  );
}

// Legend bar

function LegendBar({
  showCriticalPath,
  onToggleCriticalPath,
  criticalPathLength,
  showHierarchy,
  onToggleHierarchy,
  hasHierarchy,
}: {
  showCriticalPath: boolean;
  onToggleCriticalPath: () => void;
  criticalPathLength: number;
  showHierarchy: boolean;
  onToggleHierarchy: () => void;
  hasHierarchy: boolean;
}) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-6 border-b border-border shrink-0 bg-card">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Dependency Graph
      </span>
      <div className="flex items-center gap-5 text-xs text-muted-foreground">
        <LegendItem dotClass="bg-red-500" label="Active Blocker" />
        <LegendItem dotClass="bg-amber-500" label="Blocked" />
        <LegendItem dotClass="bg-green-500" label="Free" />
        <LegendItem dotClass="bg-muted-foreground/40" label="Completed" />
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <EdgeLegendItem color="#ef4444" dashed={false} label="Pending dep" />
        <EdgeLegendItem color="#22c55e" dashed label="Resolved dep" />
        {hasHierarchy && (
          <EdgeLegendItem color="currentColor" dashed marker="diamond" label="Subtask" />
        )}
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-2">
        {hasHierarchy && (
          <button
            type="button"
            onClick={onToggleHierarchy}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              showHierarchy
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            <TreeStructure size={12} weight={showHierarchy ? "fill" : "regular"} />
            Hierarchy
          </button>
        )}
        <button
          type="button"
          onClick={onToggleCriticalPath}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            showCriticalPath
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          <Lightning size={12} weight={showCriticalPath ? "fill" : "regular"} />
          Critical Path
          {showCriticalPath && criticalPathLength > 0 && (
            <span className="bg-primary-foreground/20 px-1.5 py-0.5 rounded text-[10px]">
              {criticalPathLength} tasks
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

function LegendItem({ dotClass, label }: { dotClass: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-sm shrink-0", dotClass)} />
      {label}
    </span>
  );
}

function EdgeLegendItem({
  color,
  dashed,
  label,
  marker = "arrow",
}: {
  color: string;
  dashed: boolean;
  label: string;
  marker?: "arrow" | "diamond";
}) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="8" className="shrink-0">
        <line
          x1={marker === "diamond" ? "7" : "0"}
          y1="4"
          x2="15"
          y2="4"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={dashed ? "4 2" : undefined}
          opacity="0.85"
        />
        {marker === "diamond" ? (
          <polygon points="0 4, 4 1, 8 4, 4 7" fill={color} opacity="0.85" />
        ) : (
          <polygon points="14 1.5, 20 4, 14 6.5" fill={color} opacity="0.85" />
        )}
      </svg>
      {label}
    </span>
  );
}
