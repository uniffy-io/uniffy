/**
 * Canvas Notes - Public exports
 */

export { CanvasEditor } from '@/features/notes/canvas/CanvasEditor';
export { CanvasToolbar } from '@/features/notes/canvas/CanvasToolbar';
export { CanvasContextMenu } from '@/features/notes/canvas/CanvasContextMenu';
export { TextNode } from '@/features/notes/canvas/nodes/TextNode';
export { NoteNode } from '@/features/notes/canvas/nodes/NoteNode';
export { MediaNode } from '@/features/notes/canvas/nodes/MediaNode';
export { ShapeNode } from '@/features/notes/canvas/nodes/ShapeNode';
export { CustomEdge } from '@/features/notes/canvas/edges/CustomEdge';
export { EdgeStyleToolbar } from '@/features/notes/canvas/components/EdgeStyleToolbar';
export { useCanvasHistory } from '@/features/notes/canvas/hooks/useCanvasHistory';
export { NodeStyleToolbar } from '@/features/notes/canvas/components/NodeStyleToolbar';
export { NODE_COLORS, BORDER_WIDTHS } from '@/features/notes/canvas/components/nodeStyleConstants';

export {
  type CanvasState,
  type CanvasNode,
  type CanvasEdge,
  type CanvasEdgeData,
  type CanvasDefaults,
  type EdgeShape,
  type NodeStyleData,
  type TextCanvasNode,
  type NoteCanvasNode,
  type MediaCanvasNode,
  type ShapeCanvasNode,
  type TextNodeData,
  type NoteNodeData,
  type MediaNodeData,
  type ShapeNodeData,
  createEmptyCanvas,
  parseCanvasContent,
  serializeCanvas,
} from '@/features/notes/canvas/types';
