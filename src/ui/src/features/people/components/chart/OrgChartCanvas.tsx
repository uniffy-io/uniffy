import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { UsersThree } from "@phosphor-icons/react";
import { useTheme } from "@/config/theme/ThemeProvider";
import { layoutTree } from "@/features/people/utils/treeLayout";
import { OrgChartNode, type PersonFlowNode } from "@/features/people/components/chart/OrgChartNode";
import { PersonHoverCard } from "@/features/people/components/chart/PersonHoverCard";
import type {
  SerializedOrgChartNode,
  SerializedTeamNode,
} from "@/features/people/store/peopleThunks";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;
const GROUP_PADDING = 20;
const GROUP_LABEL_HEIGHT = 34;

/**
 * Hard ceiling on nodes drawn at once - past it the canvas stops being
 * navigable and the browser starts dropping frames. Branches beyond the budget
 * stay collapsed until the viewer expands them.
 */
const MAX_RENDERED_NODES = 2000;

interface TeamGroupData extends Record<string, unknown> {
  name: string;
  memberCount: number;
}

type TeamGroupFlowNode = Node<TeamGroupData, "teamGroup">;

function TeamGroupNode({ data }: NodeProps<TeamGroupFlowNode>) {
  return (
    <div className="h-full w-full rounded-xl border border-primary/20 bg-primary/[0.04]">
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <UsersThree size={13} weight="duotone" className="text-primary/70" />
        <span className="text-xs font-semibold text-primary/80">{data.name}</span>
        <span className="text-[10px] text-muted-foreground">{data.memberCount}</span>
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = { person: OrgChartNode, teamGroup: TeamGroupNode };

interface OrgChartCanvasProps {
  nodes: SerializedOrgChartNode[];
  teams: SerializedTeamNode[];
  selectedTeamId: string | null;
}

/** The selected team plus every team nested under it. */
function teamSubtreeIds(teams: SerializedTeamNode[], selectedTeamId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const team of teams) {
    if (!team.parentGroupId) continue;
    const list = childrenByParent.get(team.parentGroupId);
    if (list) {
      list.push(team.groupId);
    } else {
      childrenByParent.set(team.parentGroupId, [team.groupId]);
    }
  }
  const ids = new Set<string>([selectedTeamId]);
  const queue = [selectedTeamId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return ids;
}

/** Explicit manager wins; otherwise a team member reports to their team lead. */
function effectiveManagerId(
  node: SerializedOrgChartNode,
  visibleIds: Set<string>,
): { managerId: string | null; inherited: boolean } {
  if (node.managerUserId && visibleIds.has(node.managerUserId)) {
    return { managerId: node.managerUserId, inherited: false };
  }
  for (const team of node.teams) {
    if (team.leadUserId && team.leadUserId !== node.userId && visibleIds.has(team.leadUserId)) {
      return { managerId: team.leadUserId, inherited: true };
    }
  }
  return { managerId: null, inherited: false };
}

interface HoverState {
  userId: string;
  anchor: { top: number; right: number; bottom: number; left: number };
}

const HOVER_SHOW_DELAY_MS = 350;
const HOVER_HIDE_DELAY_MS = 200;

export function OrgChartCanvas({ nodes, teams, selectedTeamId }: OrgChartCanvasProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  const [hovered, setHovered] = useState<HoverState | null>(null);
  // Only branches the viewer toggled; the rest follow the budget default.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const setBranchExpanded = useCallback((userId: string, expanded: boolean) => {
    setOverrides((prev) => ({ ...prev, [userId]: expanded }));
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const closeHoverCard = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    setHovered(null);
  }, []);

  const handleNodeMouseEnter = useCallback((event: ReactMouseEvent, node: Node) => {
    if (node.type !== "person") return;
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    showTimer.current = window.setTimeout(() => {
      setHovered({
        userId: node.id,
        anchor: {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
      });
    }, HOVER_SHOW_DELAY_MS);
  }, []);

  const scheduleHoverCardHide = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(null), HOVER_HIDE_DELAY_MS);
  }, []);

  const cancelHoverCardHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
  }, []);

  const { flowNodes, flowEdges, drawnCount, totalCount, budgetReached } = useMemo(() => {
    let candidates = nodes;
    if (selectedTeamId) {
      const teamIds = teamSubtreeIds(teams, selectedTeamId);
      candidates = nodes.filter((node) => node.teams.some((t) => teamIds.has(t.groupId)));
    }
    // Siblings cluster by team so each container wraps a contiguous block.
    candidates = [...candidates].sort((a, b) =>
      (a.teams[0]?.groupId ?? "￿").localeCompare(b.teams[0]?.groupId ?? "￿"),
    );
    const candidateIds = new Set(candidates.map((node) => node.userId));

    const managerByNode = new Map<string, { managerId: string | null; inherited: boolean }>(
      candidates.map((node) => [node.userId, effectiveManagerId(node, candidateIds)]),
    );

    // Reports under the effective (inherited included) tree, cycle-safe.
    const childrenByManager = new Map<string, string[]>();
    for (const node of candidates) {
      const { managerId } = managerByNode.get(node.userId)!;
      if (!managerId) continue;
      const list = childrenByManager.get(managerId);
      if (list) {
        list.push(node.userId);
      } else {
        childrenByManager.set(managerId, [node.userId]);
      }
    }
    const roots = candidates
      .filter((node) => managerByNode.get(node.userId)!.managerId === null)
      .map((node) => node.userId);

    const descendantCounts = new Map<string, number>();
    const countDescendants = (id: string, trail: Set<string>): number => {
      const cached = descendantCounts.get(id);
      if (cached !== undefined) return cached;
      if (trail.has(id)) return 0;
      trail.add(id);
      let count = 0;
      for (const child of childrenByManager.get(id) ?? []) {
        count += 1 + countDescendants(child, trail);
      }
      descendantCounts.set(id, count);
      return count;
    };
    for (const id of candidateIds) countDescendants(id, new Set());

    // Breadth-first default: open as many levels as the budget affords, so a
    // small org draws whole while a huge one opens at the top and waits.
    // The same walk records reachability, which tells a collapsed subtree
    // apart from a lead-inheritance cycle island later on.
    const autoExpanded = new Set<string>();
    const reachable = new Set<string>(roots);
    {
      const queue = [...roots];
      let drawn = Math.min(queue.length, MAX_RENDERED_NODES);
      for (let head = 0; head < queue.length; head++) {
        const kids = childrenByManager.get(queue[head]) ?? [];
        if (kids.length === 0) continue;
        if (drawn + kids.length <= MAX_RENDERED_NODES) {
          autoExpanded.add(queue[head]);
          drawn += kids.length;
        }
        for (const kid of kids) {
          if (reachable.has(kid)) continue;
          reachable.add(kid);
          queue.push(kid);
        }
      }
    }
    const isExpanded = (id: string) => overrides[id] ?? autoExpanded.has(id);

    const drawnIds = new Set<string>();
    const queue: string[] = [];
    let head = 0;
    let budgetExhausted = false;
    const enqueue = (id: string): boolean => {
      if (drawnIds.has(id)) return true;
      if (drawnIds.size >= MAX_RENDERED_NODES) {
        budgetExhausted = true;
        return false;
      }
      drawnIds.add(id);
      queue.push(id);
      return true;
    };
    const drain = () => {
      while (head < queue.length) {
        const id = queue[head++];
        const kids = childrenByManager.get(id) ?? [];
        if (kids.length === 0 || !isExpanded(id)) continue;
        // Siblings are all-or-nothing; half a row of reports reads as data loss.
        if (drawnIds.size + kids.length > MAX_RENDERED_NODES) {
          budgetExhausted = true;
          continue;
        }
        for (const kid of kids) enqueue(kid);
      }
    };
    for (const id of roots) enqueue(id);
    drain();
    // A lead-inheritance cycle leaves an island unreachable from any root;
    // force-root one member so the rest of it still draws. Nodes hidden by a
    // collapsed ancestor are reachable, so they stay hidden.
    for (const node of candidates) {
      if (drawnIds.has(node.userId) || reachable.has(node.userId)) continue;
      if (!enqueue(node.userId)) break;
      drain();
    }

    const visible = candidates.filter((node) => drawnIds.has(node.userId));
    const positions = layoutTree(
      visible.map((node) => ({
        id: node.userId,
        parentId: managerByNode.get(node.userId)!.managerId,
      })),
      roots,
      {
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        hGap: 48,
        vGap: 88,
      },
    );

    const personNodes: PersonFlowNode[] = visible.map((node) => {
      const kids = childrenByManager.get(node.userId) ?? [];
      return {
        id: node.userId,
        type: "person",
        position: positions.get(node.userId) ?? { x: 0, y: 0 },
        data: {
          userId: node.userId,
          displayName: node.displayName,
          jobTitle: node.jobTitle,
          avatarUrl: node.avatarUrl,
          descendantCount: descendantCounts.get(node.userId) ?? 0,
          hasReports: kids.length > 0,
          expanded: kids.length > 0 && drawnIds.has(kids[0]),
          onToggleBranch: setBranchExpanded,
        },
      };
    });

    // One container per team, drawn behind the members' bounding box. A
    // person in several teams is boxed with their first team only, so
    // containers never stack on the same node.
    const boxedBy = new Map<string, string>();
    for (const node of visible) {
      const first = node.teams[0];
      if (first) boxedBy.set(node.userId, first.groupId);
    }
    const groupNodes: TeamGroupFlowNode[] = [];
    for (const team of teams) {
      const members = personNodes.filter((n) => boxedBy.get(n.id) === team.groupId);
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((m) => m.position.x));
      const maxX = Math.max(...members.map((m) => m.position.x)) + NODE_WIDTH;
      const minY = Math.min(...members.map((m) => m.position.y));
      const maxY = Math.max(...members.map((m) => m.position.y)) + NODE_HEIGHT;
      groupNodes.push({
        id: `team-${team.groupId}`,
        type: "teamGroup",
        position: {
          x: minX - GROUP_PADDING,
          y: minY - GROUP_LABEL_HEIGHT,
        },
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_LABEL_HEIGHT + GROUP_PADDING,
        data: { name: team.name, memberCount: members.length },
        selectable: false,
        draggable: false,
        focusable: false,
        zIndex: -1,
      });
    }

    const managerEdges: Edge[] = visible.flatMap((node) => {
      const { managerId, inherited } = managerByNode.get(node.userId)!;
      if (!managerId || !drawnIds.has(managerId)) return [];
      return [
        {
          id: `manager-${node.userId}`,
          source: managerId,
          target: node.userId,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          ...(inherited && {
            style: { strokeDasharray: "5 4" },
            label: "team lead",
            labelStyle: { fontSize: 9, fill: "var(--muted-foreground, #888)" },
            labelBgStyle: { fillOpacity: 0 },
          }),
        },
      ];
    });

    return {
      flowNodes: [...groupNodes, ...personNodes],
      flowEdges: managerEdges,
      drawnCount: visible.length,
      totalCount: candidates.length,
      budgetReached: budgetExhausted,
    };
  }, [nodes, teams, selectedTeamId, overrides, setBranchExpanded]);

  return (
    <>
      <ReactFlow
        key={selectedTeamId ?? "all"}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => {
          if (node.type === "person") navigate(`/people/${node.id}`);
        }}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={scheduleHoverCardHide}
        onMove={closeHoverCard}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        panOnScroll
        zoomOnScroll
        minZoom={0.1}
        maxZoom={2}
        colorMode={resolvedTheme}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        {drawnCount < totalCount && (
          <Panel
            position="top-left"
            className="rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur"
          >
            Showing {drawnCount} of {totalCount} people
            {budgetReached
              ? " - collapse a branch or pick a team to draw more"
              : " - expand a branch to see more"}
          </Panel>
        )}
      </ReactFlow>

      {hovered && (
        <PersonHoverCard
          userId={hovered.userId}
          anchor={hovered.anchor}
          onMouseEnter={cancelHoverCardHide}
          onMouseLeave={scheduleHoverCardHide}
          onClose={closeHoverCard}
        />
      )}
    </>
  );
}
