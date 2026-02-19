/**
 * useCanvasCallbacks - React context for canvas node callbacks.
 *
 * Allows static NODE_TYPES to access dynamic handlers (text content change,
 * node style change, etc.) without recreating the nodeTypes object.
 */

import { createContext, useContext } from 'react';

interface CanvasCallbacks {
  onTextContentChange: (nodeId: string, content: string) => void;
  onShapeLabelChange: (nodeId: string, label: string) => void;
  onNodeStyleChange: (nodeId: string, updates: Record<string, unknown>) => void;
  readonly: boolean;
  contentId: string;
  editingNodeId: string | null;
  clearEditingNodeId: () => void;
}

export const CanvasCallbacksContext = createContext<CanvasCallbacks>({
  onTextContentChange: () => {},
  onShapeLabelChange: () => {},
  onNodeStyleChange: () => {},
  readonly: false,
  contentId: '',
  editingNodeId: null,
  clearEditingNodeId: () => {},
});

export function useCanvasCallbacks(): CanvasCallbacks {
  return useContext(CanvasCallbacksContext);
}
