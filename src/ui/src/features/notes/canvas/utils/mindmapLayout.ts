// Works in abstract (depth, span) coords then maps to (x, y) per direction.
import type { CanvasNode, CanvasEdge, MindMapNodeData, MindMapCanvasNode } from '@/features/notes/canvas/types';
import {
  MINDMAP_BRANCH_COLORS,
  MINDMAP_HORIZONTAL_GAP,
  MINDMAP_VERTICAL_GAP,
  MINDMAP_NODE_WIDTH,
  MINDMAP_NODE_HEIGHT,
  MINDMAP_ROOT_WIDTH,
  MINDMAP_ROOT_HEIGHT,
  type MindMapDirection,
} from '@/features/notes/canvas/components/mindmapConstants';

export interface MindMapLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  edges: CanvasEdge[];
  nodeUpdates: Map<string, Partial<MindMapNodeData>>;
}

function toXY(
  depth: number,
  span: number,
  direction: MindMapDirection,
  nodeDepthSize: number,
): { x: number; y: number } {
  switch (direction) {
    case 'right':
      return { x: depth, y: span };
    case 'down':
      return { x: span, y: depth };
    case 'left':
      return { x: -depth - nodeDepthSize, y: span };
    case 'up':
      return { x: span, y: -depth - nodeDepthSize };
  }
}

export function layoutMindMap(
  rootNodeId: string,
  allNodes: CanvasNode[],
  rootOffset: { x: number; y: number } = { x: 0, y: 0 },
): MindMapLayoutResult {
  const nodeMap = new Map<string, MindMapCanvasNode>();
  const rootNode = allNodes.find((n) => n.id === rootNodeId) as MindMapCanvasNode | undefined;
  if (!rootNode || rootNode.data.type !== 'mindmap') {
    return { positions: new Map(), edges: [], nodeUpdates: new Map() };
  }

  const mindmapId = rootNode.data.mindmapId;
  const direction: MindMapDirection = rootNode.data.direction || 'right';
  const isHorizontal = direction === 'right' || direction === 'left';

  for (const n of allNodes) {
    if (n.data.type === 'mindmap' && (n.data as MindMapNodeData).mindmapId === mindmapId) {
      nodeMap.set(n.id, n as MindMapCanvasNode);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  const edges: CanvasEdge[] = [];
  const nodeUpdates = new Map<string, Partial<MindMapNodeData>>();

  const rootData = rootNode.data;
  rootData.children.forEach((childId, index) => {
    const color = MINDMAP_BRANCH_COLORS[index % MINDMAP_BRANCH_COLORS.length];
    assignBranchColor(childId, color, nodeMap, nodeUpdates);
  });

  // depthSize: along level axis; spanSize: along sibling axis.
  function getNodeSizes(node: MindMapCanvasNode): { depthSize: number; spanSize: number } {
    const isRoot = node.data.isRoot === true;
    const w = node.measured?.width ?? (isRoot ? MINDMAP_ROOT_WIDTH : MINDMAP_NODE_WIDTH);
    const h = node.measured?.height ?? (isRoot ? MINDMAP_ROOT_HEIGHT : MINDMAP_NODE_HEIGHT);
    return isHorizontal
      ? { depthSize: w, spanSize: h }
      : { depthSize: h, spanSize: w };
  }

  function layoutSubtree(
    nodeId: string,
    depthStart: number,
    spanStart: number,
    branchColor: string,
  ): number {
    const node = nodeMap.get(nodeId);
    if (!node) return 0;

    const data = node.data;
    const { depthSize, spanSize } = getNodeSizes(node);

    const visibleChildren = data.collapsed
      ? []
      : data.children.filter((id) => nodeMap.has(id));

    if (visibleChildren.length === 0) {
      const pos = toXY(depthStart, spanStart, direction, depthSize);
      positions.set(nodeId, { x: pos.x + rootOffset.x, y: pos.y + rootOffset.y });
      return spanSize;
    }

    const childDepth = depthStart + depthSize + MINDMAP_HORIZONTAL_GAP;
    let currentSpan = spanStart;
    const childSpans: number[] = [];

    for (const childId of visibleChildren) {
      const childColor =
        nodeUpdates.get(childId)?.branchColor ??
        (nodeMap.get(childId)?.data.branchColor || branchColor);
      const s = layoutSubtree(childId, childDepth, currentSpan, childColor);
      childSpans.push(s);
      currentSpan += s + MINDMAP_VERTICAL_GAP;
    }

    const totalChildrenSpan =
      childSpans.reduce((sum, s) => sum + s, 0) +
      MINDMAP_VERTICAL_GAP * (visibleChildren.length - 1);

    const parentSpan = spanStart + totalChildrenSpan / 2 - spanSize / 2;
    const pos = toXY(depthStart, parentSpan, direction, depthSize);
    positions.set(nodeId, { x: pos.x + rootOffset.x, y: pos.y + rootOffset.y });

    for (const childId of visibleChildren) {
      const childColor =
        nodeUpdates.get(childId)?.branchColor ??
        (nodeMap.get(childId)?.data.branchColor || branchColor);
      edges.push({
        id: `mm_edge_${nodeId}_${childId}`,
        source: nodeId,
        target: childId,
        sourceHandle: 'mm-source',
        targetHandle: 'mm-target',
        type: 'mindmapEdge',
        data: { branchColor: childColor },
        selectable: false,
        deletable: false,
      });
    }

    return totalChildrenSpan;
  }

  layoutSubtree(rootNodeId, 0, 0, '');

  return { positions, edges, nodeUpdates };
}

/** Preserves user-set branchColor; falls back to inherited color only when unset. */
function assignBranchColor(
  nodeId: string,
  color: string,
  nodeMap: Map<string, MindMapCanvasNode>,
  updates: Map<string, Partial<MindMapNodeData>>,
): void {
  const node = nodeMap.get(nodeId);
  const effectiveColor = node?.data.branchColor || color;
  updates.set(nodeId, { ...(updates.get(nodeId) ?? {}), branchColor: effectiveColor });
  if (!node) return;
  for (const childId of node.data.children) {
    assignBranchColor(childId, effectiveColor, nodeMap, updates);
  }
}

export function findMindMapRoot(
  nodeId: string,
  allNodes: CanvasNode[],
): string | null {
  const nodeMap = new Map<string, MindMapCanvasNode>();
  for (const n of allNodes) {
    if (n.data.type === 'mindmap') {
      nodeMap.set(n.id, n as MindMapCanvasNode);
    }
  }

  let current = nodeMap.get(nodeId);
  while (current) {
    if (current.data.isRoot) return current.id;
    if (!current.data.parentNodeId) return current.id;
    current = nodeMap.get(current.data.parentNodeId);
  }
  return null;
}

export function collectDescendants(
  nodeId: string,
  allNodes: CanvasNode[],
): Set<string> {
  const nodeMap = new Map<string, MindMapCanvasNode>();
  for (const n of allNodes) {
    if (n.data.type === 'mindmap') {
      nodeMap.set(n.id, n as MindMapCanvasNode);
    }
  }

  const result = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    result.add(id);
    const node = nodeMap.get(id);
    if (node) {
      for (const childId of node.data.children) {
        stack.push(childId);
      }
    }
  }
  return result;
}

export function getBranchColorForNewChild(
  parentId: string,
  allNodes: CanvasNode[],
): string {
  const parent = allNodes.find((n) => n.id === parentId) as MindMapCanvasNode | undefined;
  if (!parent || parent.data.type !== 'mindmap') return MINDMAP_BRANCH_COLORS[0];

  if (parent.data.isRoot) {
    const childCount = parent.data.children.length;
    return MINDMAP_BRANCH_COLORS[childCount % MINDMAP_BRANCH_COLORS.length];
  }

  return parent.data.branchColor || MINDMAP_BRANCH_COLORS[0];
}
