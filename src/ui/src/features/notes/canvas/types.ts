import type { Node, Edge, Viewport } from '@xyflow/react';

export const CANVAS_FORMAT_VERSION = 1;

export interface NodeStyleData {
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

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
  label: string;
  mindmapId: string;
  parentNodeId: string | null;
  children: string[];
  collapsed?: boolean;
  branchColor?: string;
  isRoot?: boolean;
  direction?: 'right' | 'down' | 'left' | 'up';
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export type CanvasNodeData = TextNodeData | NoteNodeData | MediaNodeData | ShapeNodeData | MindMapNodeData;

export type TextCanvasNode = Node<TextNodeData, 'text'>;
export type NoteCanvasNode = Node<NoteNodeData, 'note'>;
export type MediaCanvasNode = Node<MediaNodeData, 'media'>;
export type ShapeCanvasNode = Node<ShapeNodeData, 'shape'>;
export type MindMapCanvasNode = Node<MindMapNodeData, 'mindmap'>;

export type CanvasNode = TextCanvasNode | NoteCanvasNode | MediaCanvasNode | ShapeCanvasNode | MindMapCanvasNode;

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

export interface CanvasDefaults {
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
  edgeColor?: string;
  edgeWidth?: number;
  edgeShape?: EdgeShape;
}

export interface CanvasState {
  version: number;
  viewport: Viewport;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  defaults?: CanvasDefaults;
}

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
    // Invalid JSON
  }

  return createEmptyCanvas();
}

export function serializeCanvas(state: CanvasState): string {
  return JSON.stringify(state);
}
