/**
 * useCanvasCallbacks - React context for canvas node callbacks.
 *
 * Allows static NODE_TYPES to access dynamic handlers (text content change,
 * node style change, etc.) without recreating the nodeTypes object.
 */

import { createContext, useContext } from "react";

interface CanvasCallbacks {
  onTextContentChange: (nodeId: string, content: string) => void;
  onShapeLabelChange: (nodeId: string, label: string) => void;
  onNodeStyleChange: (nodeId: string, updates: Record<string, unknown>) => void;
  onMindMapLabelChange: (nodeId: string, label: string) => void;
  onMindMapAddChild: (parentId: string) => void;
  onMindMapAddSibling: (nodeId: string) => void;
  onMindMapDeleteNode: (nodeId: string) => void;
  onMindMapToggleCollapse: (nodeId: string) => void;
  readonly: boolean;
  contentId: string;
  editingNodeId: string | null;
  clearEditingNodeId: () => void;
}

export const CanvasCallbacksContext = createContext<CanvasCallbacks>({
  onTextContentChange: () => {},
  onShapeLabelChange: () => {},
  onNodeStyleChange: () => {},
  onMindMapLabelChange: () => {},
  onMindMapAddChild: () => {},
  onMindMapAddSibling: () => {},
  onMindMapDeleteNode: () => {},
  onMindMapToggleCollapse: () => {},
  readonly: false,
  contentId: "",
  editingNodeId: null,
  clearEditingNodeId: () => {},
});

export function useCanvasCallbacks(): CanvasCallbacks {
  return useContext(CanvasCallbacksContext);
}
