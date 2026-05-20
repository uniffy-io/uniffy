import * as Y from 'yjs';
import type {
  CanvasDefaults,
  CanvasEdge,
  CanvasEdgeData,
  CanvasNode,
  CanvasNodeData,
} from '@/features/notes/canvas/types';

/**
 * Per-node text fields stored as `Y.Text` inside the node's `data` map so
 * concurrent typing in the same cell merges char-by-char. Fields not listed
 * here are treated as plain values by `mutateNodeYMap`.
 */
export const NODE_TEXT_FIELDS: Record<string, string> = {
  text: 'content',
  shape: 'label',
  mindmap: 'label',
};

export function nodeTextFieldKey(nodeType: string | undefined): string | null {
  if (!nodeType) return null;
  return NODE_TEXT_FIELDS[nodeType] ?? null;
}

/**
 * Yjs <-> React Flow binding for canvas notes.
 *
 * Shape: `Y.Map nodes` (id -> Y.Map with nested `data` Y.Map for clean
 * per-field merges), `Y.Array order` (render / z-order), `Y.Map edges`
 * (id -> flat Y.Map). Viewport is intentionally not synced - pan/zoom is
 * per-user UI state and would thrash the doc.
 */

export const Y_CANVAS_NODES_FIELD = 'nodes';
export const Y_CANVAS_EDGES_FIELD = 'edges';
export const Y_CANVAS_ORDER_FIELD = 'order';
export const Y_CANVAS_DEFAULTS_FIELD = 'defaults';

export function getCanvasYTypes(ydoc: Y.Doc): {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
  order: Y.Array<string>;
  defaults: Y.Map<unknown>;
} {
  return {
    nodes: ydoc.get(Y_CANVAS_NODES_FIELD, Y.Map) as Y.Map<Y.Map<unknown>>,
    edges: ydoc.get(Y_CANVAS_EDGES_FIELD, Y.Map) as Y.Map<Y.Map<unknown>>,
    order: ydoc.get(Y_CANVAS_ORDER_FIELD, Y.Array) as Y.Array<string>,
    defaults: ydoc.get(Y_CANVAS_DEFAULTS_FIELD, Y.Map) as Y.Map<unknown>,
  };
}

function nodeToYMap(node: CanvasNode): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', node.id);
  map.set('type', node.type ?? 'text');
  map.set('position', { x: node.position.x, y: node.position.y });
  if (node.width !== undefined) map.set('width', node.width);
  if (node.height !== undefined) map.set('height', node.height);
  if (node.selectable !== undefined) map.set('selectable', node.selectable);
  if (node.deletable !== undefined) map.set('deletable', node.deletable);
  if (node.draggable !== undefined) map.set('draggable', node.draggable);
  const dataMap = new Y.Map<unknown>();
  const textFieldKey = nodeTextFieldKey(node.type);
  for (const [key, value] of Object.entries(node.data ?? {})) {
    if (key === textFieldKey) {
      dataMap.set(key, new Y.Text(typeof value === 'string' ? value : ''));
    } else {
      dataMap.set(key, value);
    }
  }
  map.set('data', dataMap);
  return map;
}

function edgeToYMap(edge: CanvasEdge): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', edge.id);
  map.set('source', edge.source);
  map.set('target', edge.target);
  if (edge.sourceHandle !== undefined) map.set('sourceHandle', edge.sourceHandle);
  if (edge.targetHandle !== undefined) map.set('targetHandle', edge.targetHandle);
  if (edge.type !== undefined) map.set('type', edge.type);
  if (edge.selectable !== undefined) map.set('selectable', edge.selectable);
  if (edge.deletable !== undefined) map.set('deletable', edge.deletable);
  if (edge.data) map.set('data', { ...edge.data });
  return map;
}

function yMapToNode(map: Y.Map<unknown>): CanvasNode | null {
  const id = map.get('id') as string | undefined;
  const type = map.get('type') as string | undefined;
  const position = map.get('position') as { x: number; y: number } | undefined;
  if (!id || !position) return null;
  const dataAny = map.get('data');
  const data =
    dataAny instanceof Y.Map
      ? (materializeDataMap(dataAny) as CanvasNodeData)
      : (dataAny as CanvasNodeData);
  const node: CanvasNode = {
    id,
    type: (type ?? 'text') as CanvasNode['type'],
    position: { x: position.x, y: position.y },
    data,
  } as CanvasNode;
  if (map.has('width')) (node as { width?: number }).width = map.get('width') as number;
  if (map.has('height')) (node as { height?: number }).height = map.get('height') as number;
  if (map.has('selectable')) (node as { selectable?: boolean }).selectable = map.get('selectable') as boolean;
  if (map.has('deletable')) (node as { deletable?: boolean }).deletable = map.get('deletable') as boolean;
  if (map.has('draggable')) (node as { draggable?: boolean }).draggable = map.get('draggable') as boolean;
  return node;
}

function yMapToEdge(map: Y.Map<unknown>): CanvasEdge | null {
  const id = map.get('id') as string | undefined;
  const source = map.get('source') as string | undefined;
  const target = map.get('target') as string | undefined;
  if (!id || !source || !target) return null;
  const edge: CanvasEdge = {
    id,
    source,
    target,
    data: (map.get('data') as CanvasEdgeData | undefined) ?? undefined,
  };
  if (map.has('sourceHandle')) edge.sourceHandle = map.get('sourceHandle') as string;
  if (map.has('targetHandle')) edge.targetHandle = map.get('targetHandle') as string;
  if (map.has('type')) edge.type = map.get('type') as string;
  if (map.has('selectable')) edge.selectable = map.get('selectable') as boolean;
  if (map.has('deletable')) edge.deletable = map.get('deletable') as boolean;
  return edge;
}

/**
 * Materialise React Flow `nodes[]` / `edges[]` from the shared Y types.
 * Order follows the `order` Y.Array; nodes missing from `order` are
 * appended to stay consistent during transitional writes.
 */
export function readCanvasFromYDoc(ydoc: Y.Doc): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
} {
  const { nodes: yNodes, edges: yEdges, order: yOrder } = getCanvasYTypes(ydoc);
  // Dedupe ids: IDB hydration merged with a server seed can leave the same
  // id pushed twice into the CRDT, and React Flow rejects duplicate keys.
  const seen = new Set<string>();
  const nodes: CanvasNode[] = [];
  for (const id of yOrder) {
    if (seen.has(id)) continue;
    const yNode = yNodes.get(id);
    if (!yNode) continue;
    seen.add(id);
    const node = yMapToNode(yNode);
    if (node) nodes.push(node);
  }
  for (const [id, yNode] of yNodes.entries()) {
    if (seen.has(id)) continue;
    const node = yMapToNode(yNode);
    if (node) nodes.push(node);
  }
  const edges: CanvasEdge[] = [];
  const seenEdges = new Set<string>();
  for (const [id, yEdge] of yEdges.entries()) {
    if (seenEdges.has(id)) continue;
    seenEdges.add(id);
    const edge = yMapToEdge(yEdge);
    if (edge) edges.push(edge);
  }
  return { nodes, edges };
}

/**
 * Seed Y types from a plain `CanvasState` once on cold start. Caller MUST
 * gate on sync completion AND the Y maps being empty to avoid duplicating
 * state when the server already pushed a populated snapshot via SyncStep2.
 */
export function seedCanvasYDoc(
  ydoc: Y.Doc,
  state: { nodes: CanvasNode[]; edges: CanvasEdge[]; defaults?: CanvasDefaults },
  origin: unknown,
): void {
  const { nodes: yNodes, edges: yEdges, order: yOrder, defaults: yDefaults } = getCanvasYTypes(ydoc);
  if (yNodes.size > 0 || yEdges.size > 0 || yOrder.length > 0 || yDefaults.size > 0) return;
  ydoc.transact(() => {
    for (const node of state.nodes) {
      yNodes.set(node.id, nodeToYMap(node));
      yOrder.push([node.id]);
    }
    for (const edge of state.edges) {
      yEdges.set(edge.id, edgeToYMap(edge));
    }
    if (state.defaults) {
      for (const [key, value] of Object.entries(state.defaults)) {
        if (value !== undefined) yDefaults.set(key, value);
      }
    }
  }, origin);
}

/** Read shared per-canvas defaults; returns `undefined` when unset so
 * callers can preserve their in-memory value. */
export function readCanvasDefaults(ydoc: Y.Doc): CanvasDefaults | undefined {
  const { defaults: yDefaults } = getCanvasYTypes(ydoc);
  if (yDefaults.size === 0) return undefined;
  return Object.fromEntries(yDefaults.entries()) as CanvasDefaults;
}

/**
 * Merge `partial` into the shared defaults Y.Map. `undefined` values
 * clear the key. Runs in one transact tagged with `origin` so the
 * per-doc UndoManager groups it with the triggering action.
 */
export function writeCanvasDefaults(
  ydoc: Y.Doc,
  partial: Partial<CanvasDefaults>,
  origin: unknown,
): void {
  const { defaults: yDefaults } = getCanvasYTypes(ydoc);
  ydoc.transact(() => {
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) {
        if (yDefaults.has(key)) yDefaults.delete(key);
      } else if (yDefaults.get(key) !== value) {
        yDefaults.set(key, value);
      }
    }
  }, origin);
}

/**
 * Diff React Flow `nodes[]` / `edges[]` into the shared Y types under a
 * single `ydoc.transact(origin)` so peers can skip self-echoes and the
 * UndoManager treats the result as one step.
 */
export function writeCanvasToYDoc(
  ydoc: Y.Doc,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  origin: unknown,
): void {
  const { nodes: yNodes, edges: yEdges, order: yOrder } = getCanvasYTypes(ydoc);
  ydoc.transact(() => {
    const liveIds = new Set<string>();
    for (const node of nodes) {
      liveIds.add(node.id);
      const existing = yNodes.get(node.id);
      if (!existing) {
        yNodes.set(node.id, nodeToYMap(node));
        continue;
      }
      mutateNodeYMap(existing, node);
    }
    for (const id of Array.from(yNodes.keys())) {
      if (!liveIds.has(id)) yNodes.delete(id);
    }

    const targetOrder = nodes.map((n) => n.id);
    const orderDrift =
      targetOrder.length !== yOrder.length ||
      targetOrder.some((id, idx) => yOrder.get(idx) !== id);
    if (orderDrift) {
      if (yOrder.length > 0) yOrder.delete(0, yOrder.length);
      if (targetOrder.length > 0) yOrder.push(targetOrder);
    }

    const liveEdgeIds = new Set<string>();
    for (const edge of edges) {
      liveEdgeIds.add(edge.id);
      yEdges.set(edge.id, edgeToYMap(edge));
    }
    for (const id of Array.from(yEdges.keys())) {
      if (!liveEdgeIds.has(id)) yEdges.delete(id);
    }
  }, origin);
}

function mutateNodeYMap(map: Y.Map<unknown>, node: CanvasNode): void {
  if (map.get('type') !== node.type) map.set('type', node.type ?? 'text');
  const pos = map.get('position') as { x: number; y: number } | undefined;
  if (!pos || pos.x !== node.position.x || pos.y !== node.position.y) {
    map.set('position', { x: node.position.x, y: node.position.y });
  }
  setOptionalNumber(map, 'width', node.width);
  setOptionalNumber(map, 'height', node.height);
  setOptionalBool(map, 'selectable', node.selectable);
  setOptionalBool(map, 'deletable', node.deletable);
  setOptionalBool(map, 'draggable', node.draggable);

  const textFieldKey = nodeTextFieldKey(node.type);
  const dataMap = map.get('data');
  if (dataMap instanceof Y.Map) {
    const liveKeys = new Set<string>();
    for (const [key, value] of Object.entries(node.data ?? {})) {
      liveKeys.add(key);
      // Y.Text fields are owned by `writeNodeTextDiff`; skipping them here
      // keeps a structural write from clobbering a concurrent char edit.
      if (key === textFieldKey) {
        if (!(dataMap.get(key) instanceof Y.Text)) {
          dataMap.set(key, new Y.Text(typeof value === 'string' ? value : ''));
        }
        continue;
      }
      if (!shallowEqual(dataMap.get(key), value)) dataMap.set(key, value);
    }
    for (const key of Array.from(dataMap.keys())) {
      if (!liveKeys.has(key)) dataMap.delete(key);
    }
  } else {
    const next = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(node.data ?? {})) {
      if (key === textFieldKey) {
        next.set(key, new Y.Text(typeof value === 'string' ? value : ''));
      } else {
        next.set(key, value);
      }
    }
    map.set('data', next);
  }
}

function setOptionalNumber(
  map: Y.Map<unknown>,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key);
  } else if (map.get(key) !== value) {
    map.set(key, value);
  }
}

function setOptionalBool(
  map: Y.Map<unknown>,
  key: string,
  value: boolean | undefined,
): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key);
  } else if (map.get(key) !== value) {
    map.set(key, value);
  }
}

/** Convert a node's `data` Y.Map into the plain object React Flow consumes;
 * Y.Text values materialise as strings. */
function materializeDataMap(dataMap: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of dataMap.entries()) {
    out[key] = value instanceof Y.Text ? value.toString() : value;
  }
  return out;
}

/** Current string value of a node's text field, or `null` if missing. */
export function readNodeTextField(
  ydoc: Y.Doc,
  nodeId: string,
  fieldKey: string,
): string | null {
  const { nodes } = getCanvasYTypes(ydoc);
  const yNode = nodes.get(nodeId);
  if (!yNode) return null;
  const dataAny = yNode.get('data');
  if (!(dataAny instanceof Y.Map)) {
    const value = (dataAny as Record<string, unknown> | undefined)?.[fieldKey];
    return typeof value === 'string' ? value : null;
  }
  const raw = dataAny.get(fieldKey);
  if (raw instanceof Y.Text) return raw.toString();
  return typeof raw === 'string' ? raw : null;
}

/**
 * Apply a minimal `(prev, next)` diff to a node's text field as a `Y.Text`
 * delta so concurrent char-level edits merge instead of overwriting.
 *
 * The diff is computed against `prev` (the user's last local snapshot),
 * not against the current `Y.Text`, so a remote insert that landed between
 * two keystrokes is preserved.
 */
export function writeNodeTextDiff(
  ydoc: Y.Doc,
  nodeId: string,
  fieldKey: string,
  prev: string,
  next: string,
  origin: unknown,
): void {
  if (prev === next) return;
  const { nodes } = getCanvasYTypes(ydoc);
  const yNode = nodes.get(nodeId);
  if (!yNode) return;
  let dataMap = yNode.get('data');
  if (!(dataMap instanceof Y.Map)) {
    // Cold-start seed may leave `data` as a plain dict; upgrade in place.
    const upgraded = new Y.Map<unknown>();
    if (dataMap && typeof dataMap === 'object') {
      for (const [key, value] of Object.entries(dataMap as Record<string, unknown>)) {
        if (key === fieldKey) {
          upgraded.set(key, new Y.Text(typeof value === 'string' ? value : ''));
        } else {
          upgraded.set(key, value);
        }
      }
    }
    ydoc.transact(() => {
      yNode.set('data', upgraded);
    }, origin);
    dataMap = upgraded;
  }
  let yText = (dataMap as Y.Map<unknown>).get(fieldKey);
  if (!(yText instanceof Y.Text)) {
    const seed = typeof yText === 'string' ? yText : prev;
    const replacement = new Y.Text(seed);
    ydoc.transact(() => {
      (dataMap as Y.Map<unknown>).set(fieldKey, replacement);
    }, origin);
    yText = replacement;
  }
  const text = yText as Y.Text;
  // Diff against `prev` (the user's last-known local snapshot) so concurrent
  // peer inserts elsewhere in the string survive; Yjs's stable character ids
  // make the delete+insert at our positions merge cleanly.
  let prefix = 0;
  const minLen = Math.min(prev.length, next.length);
  while (prefix < minLen && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) suffix++;
  const deleteCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  if (deleteCount === 0 && insert.length === 0) return;
  ydoc.transact(() => {
    if (deleteCount > 0) text.delete(prefix, deleteCount);
    if (insert.length > 0) text.insert(prefix, insert);
  }, origin);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}
