/**
 * Canvas Notes Type Definitions
 *
 * Defines the JSON structure stored in Note.content for canvas notes.
 * Canvas state is serialized/deserialized to/from this format.
 */

import type { Node, Edge, Viewport } from '@xyflow/react';

/** Version of the canvas JSON format. */
export const CANVAS_FORMAT_VERSION = 1;

// -Node style fields (shared across all node types) --

export interface NodeStyleData {
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

// -Node data types ----

export interface TextNodeData extends Record<string, unknown> {
  type: 'text';
  content: string;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
}

export interface NoteNodeData extends Record<string, unknown> {
  type: 'note';
  urn: string;
  noteId: string;
  title?: string;
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface MediaNodeData extends Record<string, unknown> {
  type: 'media';
  fileId: string;
  mimeType: string;
  filename: string;
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface ShapeNodeData extends Record<string, unknown> {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'diamond';
  label?: string;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface MindMapNodeData extends Record<string, unknown> {
  type: 'mindmap';
  /** Display text for this mind map node. */
  label: string;
  /** Groups all nodes belonging to the same mind map instance. */
  mindmapId: string;
  /** Parent node ID within the mind map tree. Null for the root node. */
  parentNodeId: string | null;
  /** Ordered child node IDs. */
  children: string[];
  /** When true, children are hidden in the layout. */
  collapsed?: boolean;
  /** Branch color inherited from the top-level ancestor. */
  branchColor?: string;
  /** True only for the root node of a mind map. */
  isRoot?: boolean;
  /** Layout direction for the tree. Stored on every node, changed from root. */
  direction?: 'right' | 'down' | 'left' | 'up';
  /** Text formatting options. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  /** Visual styling. */
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export type CanvasNodeData = TextNodeData | NoteNodeData | MediaNodeData | ShapeNodeData | MindMapNodeData;

// -React Flow node types --

export type TextCanvasNode = Node<TextNodeData, 'text'>;
export type NoteCanvasNode = Node<NoteNodeData, 'note'>;
export type MediaCanvasNode = Node<MediaNodeData, 'media'>;
export type ShapeCanvasNode = Node<ShapeNodeData, 'shape'>;
export type MindMapCanvasNode = Node<MindMapNodeData, 'mindmap'>;

export type CanvasNode = TextCanvasNode | NoteCanvasNode | MediaCanvasNode | ShapeCanvasNode | MindMapCanvasNode;

// -Edge types --

export type EdgeShape = 'default' | 'straight' | 'step' | 'smoothstep';

export interface CanvasEdgeData extends Record<string, unknown> {
  label?: string;
  strokeColor?: string;
  strokeWidth?: number;
  edgeShape?: EdgeShape;
}

export type CanvasEdge = Edge<CanvasEdgeData>;

export interface MindMapEdgeData extends Record<string, unknown> {
  branchColor: string;
}

export type MindMapEdge = Edge<MindMapEdgeData>;

// -Per-canvas default styles for new nodes --

export interface CanvasDefaults {
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
  edgeColor?: string;
  edgeWidth?: number;
  edgeShape?: EdgeShape;
}

// -Canvas state (stored as Note.content JSON) --

export interface CanvasState {
  version: number;
  viewport: Viewport;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  defaults?: CanvasDefaults;
}

// -Helpers --

export function createEmptyCanvas(): CanvasState {
  return {
    version: CANVAS_FORMAT_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}

export function parseCanvasContent(content: string): CanvasState {
  if (!content) {
    return createEmptyCanvas();
  }

  try {
    const parsed = JSON.parse(content) as CanvasState;
    if (parsed.version && Array.isArray(parsed.nodes)) {
      return {
        version: parsed.version,
        viewport: parsed.viewport ?? { x: 0, y: 0, zoom: 1 },
        nodes: parsed.nodes ?? [],
        edges: parsed.edges ?? [],
        defaults: parsed.defaults,
      };
    }
  } catch {
    // Invalid JSON, return empty canvas
  }

  return createEmptyCanvas();
}

export function serializeCanvas(state: CanvasState): string {
  return JSON.stringify(state);
}
