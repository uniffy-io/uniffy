export interface TreeLayoutNode {
  id: string;
  parentId: string | null;
}

export interface TreeLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  hGap?: number;
  vGap?: number;
}

export interface TreePosition {
  x: number;
  y: number;
}

/**
 * Tidy-tree layout over parent edges: every subtree occupies a contiguous run
 * of leaf slots and each parent sits centered over its children, so sibling
 * subtrees can never overlap. Multiple roots lay out side by side.
 *
 * The input is untrusted: cycles, self-parents and dangling parent ids must
 * terminate with every node placed, never loop or recurse unboundedly.
 */
export function layoutTree(
  nodes: TreeLayoutNode[],
  roots: string[],
  options: TreeLayoutOptions = {},
): Map<string, TreePosition> {
  const { nodeWidth = 220, nodeHeight = 72, hGap = 40, vGap = 80 } = options;
  const slotWidth = nodeWidth + hGap;
  const levelHeight = nodeHeight + vGap;

  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const hasValidParent = new Set<string>();
  for (const node of nodes) {
    if (!node.parentId || node.parentId === node.id || !ids.has(node.parentId)) {
      continue;
    }
    hasValidParent.add(node.id);
    const list = children.get(node.parentId);
    if (list) {
      list.push(node.id);
    } else {
      children.set(node.parentId, [node.id]);
    }
  }

  const rootSet = new Set<string>();
  for (const id of roots) {
    if (ids.has(id)) rootSet.add(id);
  }
  for (const node of nodes) {
    if (!hasValidParent.has(node.id)) rootSet.add(node.id);
  }

  const positions = new Map<string, TreePosition>();
  const visited = new Set<string>();
  let nextSlot = 0;

  // Iterative post-order: children first, then center the parent over them.
  const place = (rootId: string) => {
    const stack: { id: string; depth: number; expanded: boolean }[] = [
      { id: rootId, depth: 0, expanded: false },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.expanded) {
        frame.expanded = true;
        visited.add(frame.id);
        const kids = (children.get(frame.id) ?? []).filter((c) => !visited.has(c));
        for (const kid of kids) visited.add(kid);
        for (let i = kids.length - 1; i >= 0; i--) {
          stack.push({ id: kids[i], depth: frame.depth + 1, expanded: false });
        }
        continue;
      }
      stack.pop();
      const kids = children.get(frame.id) ?? [];
      const placedKids = kids
        .map((kid) => positions.get(kid))
        .filter((p): p is TreePosition => p !== undefined);
      const x =
        placedKids.length > 0
          ? (placedKids[0].x + placedKids[placedKids.length - 1].x) / 2
          : nextSlot++ * slotWidth;
      positions.set(frame.id, { x, y: frame.depth * levelHeight });
    }
  };

  for (const rootId of rootSet) {
    if (!visited.has(rootId)) place(rootId);
  }
  // Cycle islands are unreachable from any root; force-root one member so the
  // rest of the cycle lays out beneath it.
  for (const node of nodes) {
    if (!visited.has(node.id)) place(node.id);
  }

  return positions;
}
