/**
 * Mind map tree layout algorithm.
 *
 * Takes the flat list of canvas nodes, filters to a specific mind map group,
 * and computes tree positions + auto-generated edges.
 *
 * Supports four layout directions (right, down, left, up).
 * The algorithm works in an abstract (depth, span) coordinate system
 * then maps to (x, y) based on the chosen direction.
 *
 * Layout strategy:
 * - Root at origin, children fan out along the depth axis
 * - Each level is offset by LEVEL_GAP (depth between parent and child)
 * - Siblings are spaced by SIBLING_GAP along the span axis
 * - Parent is centered along the span axis relative to its children
 * - Collapsed nodes hide their entire subtree
 * - Each top-level branch gets a distinct color from MINDMAP_BRANCH_COLORS
 */

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
  /** New positions for each mind map node. */
  positions: Map<string, { x: number; y: number }>;
  /** Auto-generated edges between parent-child pairs. */
  edges: CanvasEdge[];
  /** Updated node data with assigned branch colors. */
  nodeUpdates: Map<string, Partial<MindMapNodeData>>;
}

/**
 * Convert abstract (depth, span) coordinates to (x, y) based on direction.
 *
 * - right: depth = +x, span = +y
 * - down:  depth = +y, span = +x
 * - left:  depth = -x (offset by nodeDepthSize), span = +y
 * - up:    depth = -y (offset by nodeDepthSize), span = +x
 */
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

/**
 * Compute layout for all nodes belonging to a single mind map.
 *
 * @param rootNodeId - The root node ID of the mind map
 * @param allNodes - All canvas nodes (filtered internally by mindmapId)
 * @param rootOffset - Base position offset (where the root was originally placed)
 */
export function layoutMindMap(
  rootNodeId: string,
  allNodes: CanvasNode[],
  rootOffset: { x: number; y: number } = { x: 0, y: 0 },
): MindMapLayoutResult {
  // Build lookup of mind map nodes by ID
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

  // Assign branch colors to top-level children
  const rootData = rootNode.data;
  rootData.children.forEach((childId, index) => {
    const color = MINDMAP_BRANCH_COLORS[index % MINDMAP_BRANCH_COLORS.length];
    assignBranchColor(childId, color, nodeMap, nodeUpdates);
  });

  /**
   * Get node dimensions in abstract layout coordinates.
   * "depthSize" = size along the level axis (parent -> child)
   * "spanSize" = size along the sibling axis
   */
  function getNodeSizes(node: MindMapCanvasNode): { depthSize: number; spanSize: number } {
    const isRoot = node.data.isRoot === true;
    const w = node.measured?.width ?? (isRoot ? MINDMAP_ROOT_WIDTH : MINDMAP_NODE_WIDTH);
    const h = node.measured?.height ?? (isRoot ? MINDMAP_ROOT_HEIGHT : MINDMAP_NODE_HEIGHT);
    return isHorizontal
      ? { depthSize: w, spanSize: h }
      : { depthSize: h, spanSize: w };
  }

  /**
   * Recursively compute the span of a subtree and place nodes.
   * Returns the total span consumed by the subtree.
   */
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

    // Determine visible children (not collapsed, existing)
    const visibleChildren = data.collapsed
      ? []
      : data.children.filter((id) => nodeMap.has(id));

    if (visibleChildren.length === 0) {
      // Leaf node: place at spanStart
      const pos = toXY(depthStart, spanStart, direction, depthSize);
      positions.set(nodeId, { x: pos.x + rootOffset.x, y: pos.y + rootOffset.y });
      return spanSize;
    }

    // Layout children first to determine total span
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

    // Center parent along the span axis relative to children
    const parentSpan = spanStart + totalChildrenSpan / 2 - spanSize / 2;
    const pos = toXY(depthStart, parentSpan, direction, depthSize);
    positions.set(nodeId, { x: pos.x + rootOffset.x, y: pos.y + rootOffset.y });

    // Create edges to visible children
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

/** Recursively assign a branch color to a node and all its descendants.
 *  Preserves user-set branchColor when present; only falls back to the
 *  inherited `color` when the node has no branchColor of its own. */
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

/**
 * Find the root node ID for a given mind map node.
 * Walks up the parentNodeId chain until finding a node with isRoot=true.
 */
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

/**
 * Collect all descendant IDs of a node (including the node itself).
 */
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

/**
 * Get the branch color for a new child node.
 * If the parent is the root, assign the next color from the palette.
 * Otherwise, inherit the parent's branch color.
 */
export function getBranchColorForNewChild(
  parentId: string,
  allNodes: CanvasNode[],
): string {
  const parent = allNodes.find((n) => n.id === parentId) as MindMapCanvasNode | undefined;
  if (!parent || parent.data.type !== 'mindmap') return MINDMAP_BRANCH_COLORS[0];

  if (parent.data.isRoot) {
    // Assign next color based on number of existing children
    const childCount = parent.data.children.length;
    return MINDMAP_BRANCH_COLORS[childCount % MINDMAP_BRANCH_COLORS.length];
  }

  // Inherit parent's branch color
  return parent.data.branchColor || MINDMAP_BRANCH_COLORS[0];
}
