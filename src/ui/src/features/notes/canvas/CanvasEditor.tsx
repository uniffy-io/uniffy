/**
 * CanvasEditor - Main infinite canvas component.
 *
 * Wraps React Flow with custom node types (text, note, media, shape).
 * Supports edge connections, context menu, undo/redo,
 * and keyboard shortcuts. onChange serializes state to JSON for autosave.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  ReactFlowProvider,
  type OnConnect,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  addEdge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@/features/notes/canvas/styles/canvas.css';

import { TextNode } from '@/features/notes/canvas/nodes/TextNode';
import { NoteNode } from '@/features/notes/canvas/nodes/NoteNode';
import { MediaNode } from '@/features/notes/canvas/nodes/MediaNode';
import { ShapeNode } from '@/features/notes/canvas/nodes/ShapeNode';
import { MindMapNode } from '@/features/notes/canvas/nodes/MindMapNode';
import { CanvasToolbar } from '@/features/notes/canvas/CanvasToolbar';
import { CanvasContextMenu } from '@/features/notes/canvas/CanvasContextMenu';
import { CustomEdge } from '@/features/notes/canvas/edges/CustomEdge';
import { MindMapEdge } from '@/features/notes/canvas/edges/MindMapEdge';
import { EdgeStyleToolbar } from '@/features/notes/canvas/components/EdgeStyleToolbar';
import { useCanvasHistory } from '@/features/notes/canvas/hooks/useCanvasHistory';
import {
  layoutMindMap,
  findMindMapRoot,
  collectDescendants,
  getBranchColorForNewChild,
} from '@/features/notes/canvas/utils/mindmapLayout';
import type {
  CanvasState,
  CanvasNode,
  CanvasEdge,
  CanvasEdgeData,
  CanvasDefaults,
  TextCanvasNode,
  NoteCanvasNode,
  MediaCanvasNode,
  ShapeCanvasNode,
  MindMapCanvasNode,
  MindMapNodeData,
} from '@/features/notes/canvas/types';
import { cn } from '@/shared/utils/cn';
import { useTheme } from '@/config/theme/ThemeProvider';
import { useAppSelector } from '@/app/hooks';
import { uploadImage } from '@/components/editor/utils/imageUploader';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';
import { CanvasCallbacksContext } from '@/features/notes/canvas/hooks/useCanvasCallbacks';
import { SearchResultsList } from '@/features/search/components/SearchResultsList';
import { useSearch } from '@/features/search/hooks/useSearch';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { MagnifyingGlass } from '@phosphor-icons/react';

interface CanvasEditorProps {
  canvasState: CanvasState;
  onChange: (state: CanvasState) => void;
  readonly?: boolean;
  contentId: string;
}

/** Generate a unique ID for new nodes. */
function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  mindMapInfo?: {
    isRoot: boolean;
    hasChildren: boolean;
    isCollapsed: boolean;
    branchColor: string;
    direction: string;
  };
}

/** Static nodeTypes -- defined outside the component to avoid re-creation. */
const NODE_TYPES: NodeTypes = {
  text: TextNode,
  note: NoteNode,
  media: MediaNode,
  shape: ShapeNode,
  mindmap: MindMapNode,
};

/** Static edgeTypes -- custom edge rendering for all edges. */
const EDGE_TYPES: EdgeTypes = {
  custom: CustomEdge as EdgeTypes[string],
  mindmapEdge: MindMapEdge as EdgeTypes[string],
};

interface SelectedEdgeState {
  edgeId: string;
  x: number;
  y: number;
}

function CanvasEditorInner({
  canvasState,
  onChange,
  readonly = false,
  contentId,
}: CanvasEditorProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { resolvedTheme } = useTheme();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const canvasStateRef = useRef(canvasState);
  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(canvasState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(canvasState.edges);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeState | null>(null);
  const [showContentPicker, setShowContentPicker] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const clearEditingNodeId = useCallback(() => setEditingNodeId(null), []);

  const contentPickerInputRef = useRef<HTMLInputElement>(null);
  const contentPickerRef = useRef<HTMLDivElement>(null);
  const { query: pickerQuery, setQuery: setPickerQuery, results: pickerResults, isLoading: pickerLoading, clearResults: clearPickerResults } = useSearch({ limit: 15 });

  const { pushState, undo, redo } = useCanvasHistory();

  // Track if we need to emit onChange (debounced via interaction)
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Compute mind map edges from a set of nodes (for saving). */
  const computeMmEdgesFromNodes = useCallback((nodeList: CanvasNode[]): CanvasEdge[] => {
    const result: CanvasEdge[] = [];
    for (const node of nodeList) {
      if (node.data.type !== 'mindmap') continue;
      const mmData = node.data as MindMapNodeData;
      if (mmData.collapsed) continue;
      for (const childId of mmData.children) {
        const child = nodeList.find((n) => n.id === childId);
        if (!child || child.data.type !== 'mindmap') continue;
        const childColor = (child.data as MindMapNodeData).branchColor || '';
        result.push({
          id: `mm_edge_${node.id}_${childId}`,
          source: node.id,
          target: childId,
          sourceHandle: 'mm-source',
          targetHandle: 'mm-target',
          type: 'mindmapEdge',
          data: { branchColor: childColor },
          selectable: false,
          deletable: false,
        });
      }
    }
    return result;
  }, []);

  const scheduleChange = useCallback(
    (updatedNodes?: CanvasNode[], updatedEdges?: CanvasEdge[]) => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
      }
      changeTimerRef.current = setTimeout(() => {
        const currentState = canvasStateRef.current;
        const finalNodes = updatedNodes ?? nodes;
        // Combine user edges with computed mind map edges for persistence
        const userEdges = (updatedEdges ?? edges).filter((e) => e.type !== 'mindmapEdge');
        const mmEdges = computeMmEdgesFromNodes(finalNodes);
        const newState: CanvasState = {
          ...currentState,
          nodes: finalNodes,
          edges: [...userEdges, ...mmEdges] as CanvasEdge[],
        };
        pushState(currentState);
        onChange(newState);
      }, 300);
    },
    [onChange, nodes, edges, pushState, computeMmEdgesFromNodes]
  );

  // Declaratively compute mind map edges from node state. This avoids all timing
  // issues - edges are always in sync with nodes because they're derived, not managed.
  const computedMmEdges = useMemo(() => {
    const mmEdges: CanvasEdge[] = [];
    for (const node of nodes) {
      if (node.data.type !== 'mindmap') continue;
      const mmData = node.data as MindMapNodeData;
      if (mmData.collapsed) continue;
      for (const childId of mmData.children) {
        const child = nodes.find((n) => n.id === childId);
        if (!child || child.data.type !== 'mindmap') continue;
        const childColor = (child.data as MindMapNodeData).branchColor || '';
        mmEdges.push({
          id: `mm_edge_${node.id}_${childId}`,
          source: node.id,
          target: childId,
          sourceHandle: 'mm-source',
          targetHandle: 'mm-target',
          type: 'mindmapEdge',
          data: { branchColor: childColor },
          selectable: false,
          deletable: false,
        });
      }
    }
    return mmEdges;
  }, [nodes]);

  // Combine user-created edges with computed mind map edges for rendering
  const allEdges = useMemo(() => {
    const userEdges = edges.filter((e) => e.type !== 'mindmapEdge');
    return [...userEdges, ...computedMmEdges] as CanvasEdge[];
  }, [edges, computedMmEdges]);

  /** Helper: run layout for a mind map group and apply positions + edges. */
  const applyMindMapLayout = useCallback(
    (rootId: string, updatedNodes: CanvasNode[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } => {
      const rootNode = updatedNodes.find((n) => n.id === rootId);
      if (!rootNode) return { nodes: updatedNodes, edges: [] };

      const rootPos = rootNode.position;
      const result = layoutMindMap(rootId, updatedNodes, rootPos);

      // Correct positions so the root stays at its exact position.
      // The layout algorithm may shift the root vertically to center it
      // among children; this correction ensures drag positions are preserved.
      const computedRootPos = result.positions.get(rootId);
      const correctionX = computedRootPos ? rootPos.x - computedRootPos.x : 0;
      const correctionY = computedRootPos ? rootPos.y - computedRootPos.y : 0;

      // Apply corrected positions; root is draggable, children are not
      const positioned = updatedNodes.map((n) => {
        const pos = result.positions.get(n.id);
        if (pos) {
          const isRootNode = n.data.type === 'mindmap' && (n.data as MindMapNodeData).isRoot === true;
          return {
            ...n,
            position: { x: pos.x + correctionX, y: pos.y + correctionY },
            draggable: isRootNode,
          };
        }
        return n;
      }) as CanvasNode[];

      // Apply branch color updates
      for (const [nodeId, updates] of result.nodeUpdates) {
        const idx = positioned.findIndex((n) => n.id === nodeId);
        if (idx !== -1) {
          positioned[idx] = {
            ...positioned[idx],
            data: { ...positioned[idx].data, ...updates },
          } as CanvasNode;
        }
      }

      return { nodes: positioned, edges: result.edges };
    },
    []
  );

  // Handle node changes (move, resize, select)
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);

      const hasStructuralChange = changes.some(
        (c) => c.type === 'position' || c.type === 'dimensions' || c.type === 'remove'
      );
      if (!hasStructuralChange || readonly) return;

      // Re-layout mind map trees when any mind map node's dimensions change,
      // so children shift to account for wider/taller parent nodes.
      const hasMmDimensionChange = changes.some(
        (c) => c.type === 'dimensions' && c.id && nodes.find((n) => n.id === c.id)?.data.type === 'mindmap'
      );
      if (hasMmDimensionChange) {
        setNodes((nds) => {
          // Find all unique mind map roots that need re-layout
          const rootIds = new Set<string>();
          for (const c of changes) {
            if (c.type !== 'dimensions') continue;
            const node = nds.find((n) => n.id === c.id);
            if (!node || node.data.type !== 'mindmap') continue;
            const rootId = findMindMapRoot(node.id, nds);
            if (rootId) rootIds.add(rootId);
          }
          if (rootIds.size === 0) return nds;
          let result = nds;
          for (const rootId of rootIds) {
            const { nodes: laid } = applyMindMapLayout(rootId, result);
            result = laid;
          }
          return result;
        });
      }

      // Re-layout mind map trees when a root node is dragged,
      // so child nodes follow the root's new position.
      const hasMmRootPositionChange = changes.some(
        (c) => c.type === 'position' && c.position &&
          nodes.find((n) => n.id === c.id && n.data.type === 'mindmap' && (n.data as MindMapNodeData).isRoot)
      );
      if (hasMmRootPositionChange) {
        setNodes((nds) => {
          const rootIds = new Set<string>();
          for (const c of changes) {
            if (c.type !== 'position' || !c.position) continue;
            const node = nds.find((n) => n.id === c.id);
            if (node?.data.type === 'mindmap' && (node.data as MindMapNodeData).isRoot) {
              rootIds.add(c.id);
            }
          }
          if (rootIds.size === 0) return nds;
          let result = nds;
          for (const rootId of rootIds) {
            const { nodes: laid } = applyMindMapLayout(rootId, result);
            result = laid;
          }
          return result;
        });
      }

      requestAnimationFrame(() => {
        scheduleChange();
      });
    },
    [onNodesChange, readonly, scheduleChange, nodes, setNodes, applyMindMapLayout]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      onEdgesChange(changes);
      if (!readonly) {
        requestAnimationFrame(() => {
          scheduleChange();
        });
      }
    },
    [onEdgesChange, readonly, scheduleChange]
  );

  // Get per-canvas default styles for new edges
  const getEdgeDefaults = useCallback((): Partial<CanvasEdgeData> => {
    const d = canvasStateRef.current.defaults;
    if (!d) return {};
    const result: Partial<CanvasEdgeData> = {};
    if (d.edgeColor) result.strokeColor = d.edgeColor;
    if (d.edgeWidth !== undefined) result.strokeWidth = d.edgeWidth;
    if (d.edgeShape) result.edgeShape = d.edgeShape;
    return result;
  }, []);

  // Handle connections between nodes
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (readonly) return;
      const edgeDefaults = getEdgeDefaults();
      setEdges((eds) => {
        const newEdge = {
          ...connection,
          id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'custom',
          data: { ...edgeDefaults },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- addEdge generic constraint is stricter than Edge's optional `type` field
        const newEdges = addEdge(newEdge, eds as any) as CanvasEdge[];
        scheduleChange(undefined, newEdges);
        return newEdges;
      });
    },
    [setEdges, readonly, scheduleChange, getEdgeDefaults]
  );

  // Handle edge click to show style toolbar (skip auto-managed mind map edges)
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: CanvasEdge) => {
      if (readonly || edge.type === 'mindmapEdge') return;
      setSelectedEdge({ edgeId: edge.id, x: event.clientX, y: event.clientY });
      setContextMenu(null);
    },
    [readonly]
  );

  // Handle edge style changes from the toolbar
  const handleEdgeStyleChange = useCallback(
    (edgeId: string, updates: Partial<CanvasEdgeData>) => {
      if (readonly) return;
      setEdges((eds) => {
        const updated = eds.map((e) => {
          if (e.id === edgeId) {
            return { ...e, data: { ...e.data, ...updates } };
          }
          return e;
        }) as CanvasEdge[];
        scheduleChange(undefined, updated);
        return updated;
      });
    },
    [setEdges, readonly, scheduleChange]
  );

  // Handle text node content changes
  const handleTextContentChange = useCallback(
    (nodeId: string, content: string) => {
      if (readonly) return;
      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id === nodeId && n.data.type === 'text') {
            return { ...n, data: { ...n.data, content } };
          }
          return n;
        }) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, readonly, scheduleChange]
  );

  // Handle shape label changes
  const handleShapeLabelChange = useCallback(
    (nodeId: string, label: string) => {
      if (readonly) return;
      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id === nodeId && n.data.type === 'shape') {
            return { ...n, data: { ...n.data, label } };
          }
          return n;
        }) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, readonly, scheduleChange]
  );

  // Handle node style changes (bgColor, color, borderColor, borderWidth)
  const handleNodeStyleChange = useCallback(
    (nodeId: string, updates: Record<string, unknown>) => {
      if (readonly) return;

      // For mind map nodes with branchColor change, propagate to descendants and re-layout
      if ('branchColor' in updates) {
        setNodes((nds) => {
          const node = nds.find((n) => n.id === nodeId);
          if (!node || node.data.type !== 'mindmap') {
            // Not a mind map node, do normal update
            const updated = nds.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n,
            ) as CanvasNode[];
            scheduleChange(updated);
            return updated;
          }

          // Propagate branchColor to node and all descendants
          const color = updates.branchColor as string;
          const descendants = collectDescendants(nodeId, nds);
          const updated = nds.map((n) => {
            if (descendants.has(n.id)) {
              return { ...n, data: { ...n.data, branchColor: color } };
            }
            return n;
          }) as CanvasNode[];

          // Re-layout to update positions and branch colors
          const rootId = findMindMapRoot(nodeId, updated);
          if (!rootId) {
            scheduleChange(updated);
            return updated;
          }
          const { nodes: laid } = applyMindMapLayout(rootId, updated);
          scheduleChange(laid);
          return laid;
        });
        return;
      }

      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id === nodeId) {
            return { ...n, data: { ...n.data, ...updates } };
          }
          return n;
        }) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, readonly, scheduleChange, applyMindMapLayout]
  );

  // Get center position for new nodes
  const getCenterPosition = useCallback(() => {
    return screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  }, [screenToFlowPosition]);

  // Get per-canvas default styles for new nodes
  const getStyleDefaults = useCallback(() => {
    const d = canvasStateRef.current.defaults;
    if (!d) return {};
    const result: Record<string, unknown> = {};
    if (d.bgColor) result.bgColor = d.bgColor;
    if (d.borderColor) result.borderColor = d.borderColor;
    if (d.borderWidth !== undefined) result.borderWidth = d.borderWidth;
    return result;
  }, []);

  // Update per-canvas defaults
  const handleDefaultsChange = useCallback(
    (newDefaults: CanvasDefaults) => {
      if (readonly) return;
      const currentState = canvasStateRef.current;
      const updated: CanvasState = {
        ...currentState,
        defaults: { ...currentState.defaults, ...newDefaults },
        nodes,
        edges,
      };
      onChange(updated);
    },
    [readonly, onChange, nodes, edges]
  );

  // Add text block
  const handleAddTextBlock = useCallback(() => {
    if (readonly) return;
    const position = getCenterPosition();
    const defaults = getStyleDefaults();
    const nodeId = generateNodeId();
    const newNode: TextCanvasNode = {
      id: nodeId,
      type: 'text',
      position,
      selected: true,
      data: { type: 'text', content: '', ...defaults },
      style: { width: 250, height: 40 },
    };
    setNodes((nds) => {
      // Deselect all existing nodes
      const deselected = nds.map((n) => ({ ...n, selected: false }));
      const updated = [...deselected, newNode] as CanvasNode[];
      scheduleChange(updated);
      return updated;
    });
    setEditingNodeId(nodeId);
  }, [readonly, getCenterPosition, getStyleDefaults, setNodes, scheduleChange]);

  // Add media node (uploads file first, then creates canvas node)
  const handleAddMediaFile = useCallback(
    async (file: File) => {
      if (readonly || !organizationId) return;
      try {
        const result = await uploadImage({
          file,
          organizationId,
          contentId,
          contentType: ContentType.NOTE,
        });
        // Extract fileId from the returned URL: /api/files/{orgId}/{fileId}
        const urlParts = result.split('/');
        const fileId = urlParts[urlParts.length - 1];

        const position = getCenterPosition();
        const defaults = getStyleDefaults();
        const newNode: MediaCanvasNode = {
          id: generateNodeId(),
          type: 'media',
          position,
          data: { type: 'media', fileId, mimeType: file.type, filename: file.name, ...defaults },
          style: { width: 320, height: 240 },
        };
        setNodes((nds) => {
          const updated = [...nds, newNode] as CanvasNode[];
          scheduleChange(updated);
          return updated;
        });
      } catch {
        // Upload failed -- silently ignore for now
      }
    },
    [readonly, organizationId, contentId, getCenterPosition, getStyleDefaults, setNodes, scheduleChange]
  );

  // Add shape node
  const handleAddShape = useCallback(
    (shape: 'rect' | 'ellipse' | 'diamond') => {
      if (readonly) return;
      const position = getCenterPosition();
      const defaults = getStyleDefaults();
      // Shapes use "color" for SVG fill, so map bgColor -> color
      const shapeDefaults: Record<string, unknown> = {};
      if (defaults.bgColor) shapeDefaults.color = defaults.bgColor;
      if (defaults.borderColor) shapeDefaults.borderColor = defaults.borderColor;
      if (defaults.borderWidth !== undefined) shapeDefaults.borderWidth = defaults.borderWidth;
      const newNode: ShapeCanvasNode = {
        id: generateNodeId(),
        type: 'shape',
        position,
        data: { type: 'shape', shape, label: '', ...shapeDefaults },
        style: { width: 120, height: 120 },
      };
      setNodes((nds) => {
        const updated = [...nds, newNode] as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [readonly, getCenterPosition, getStyleDefaults, setNodes, scheduleChange]
  );

  // -- Mind map handlers --

  /** Add a new mind map (root + 2 starter children) at canvas center. */
  const handleAddMindMap = useCallback(() => {
    if (readonly) return;
    const position = getCenterPosition();
    const mindmapId = `mm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rootId = generateNodeId();
    const child1Id = generateNodeId();
    const child2Id = generateNodeId();

    const rootNode: MindMapCanvasNode = {
      id: rootId,
      type: 'mindmap',
      position,
      data: {
        type: 'mindmap',
        label: 'Central Idea',
        mindmapId,
        parentNodeId: null,
        children: [child1Id, child2Id],
        isRoot: true,
      },
      draggable: true,
      selectable: true,
    };

    const child1: MindMapCanvasNode = {
      id: child1Id,
      type: 'mindmap',
      position: { x: position.x + 300, y: position.y - 40 },
      data: {
        type: 'mindmap',
        label: 'Branch 1',
        mindmapId,
        parentNodeId: rootId,
        children: [],
      },
      draggable: false,
      selectable: true,
    };

    const child2: MindMapCanvasNode = {
      id: child2Id,
      type: 'mindmap',
      position: { x: position.x + 300, y: position.y + 40 },
      data: {
        type: 'mindmap',
        label: 'Branch 2',
        mindmapId,
        parentNodeId: rootId,
        children: [],
      },
      draggable: false,
      selectable: true,
    };

    setNodes((nds) => {
      const withNew = [...nds, rootNode, child1, child2] as CanvasNode[];
      const { nodes: laid } = applyMindMapLayout(rootId, withNew);
      scheduleChange(laid);
      return laid;
    });
    setEditingNodeId(rootId);
  }, [readonly, getCenterPosition, setNodes, scheduleChange, applyMindMapLayout]);

  /** Add child to a mind map node. */
  const handleMindMapAddChild = useCallback(
    (parentId: string) => {
      if (readonly) return;
      let newChildId = '';
      setNodes((nds) => {
        const parent = nds.find((n) => n.id === parentId) as MindMapCanvasNode | undefined;
        if (!parent || parent.data.type !== 'mindmap') return nds;

        const branchColor = getBranchColorForNewChild(parentId, nds);
        const childId = generateNodeId();
        newChildId = childId;

        // Update parent to include new child
        const updatedNds = nds.map((n) => {
          if (n.id === parentId && n.data.type === 'mindmap') {
            return {
              ...n,
              data: {
                ...n.data,
                children: [...(n.data as MindMapNodeData).children, childId],
                collapsed: false,
              },
            } as CanvasNode;
          }
          return n;
        }) as CanvasNode[];

        // Create new child node (inherit direction from root)
        const rootId = findMindMapRoot(parentId, nds);
        const rootNode = rootId ? nds.find((n) => n.id === rootId) as MindMapCanvasNode | undefined : undefined;
        const direction = rootNode ? (rootNode.data as MindMapNodeData).direction : undefined;

        const newChild: MindMapCanvasNode = {
          id: childId,
          type: 'mindmap',
          position: { x: parent.position.x + 300, y: parent.position.y },
          data: {
            type: 'mindmap',
            label: 'New idea',
            mindmapId: parent.data.mindmapId,
            parentNodeId: parentId,
            children: [],
            branchColor,
            ...(direction ? { direction } : {}),
          },
          draggable: false,
          selectable: true,
        };

        const withChild = [...updatedNds, newChild] as CanvasNode[];
        const layoutRootId = rootId ?? findMindMapRoot(parentId, withChild);
        if (!layoutRootId) return withChild;

        const { nodes: laid } = applyMindMapLayout(layoutRootId, withChild);
        scheduleChange(laid);
        return laid;
      });
      if (newChildId) setEditingNodeId(newChildId);
    },
    [readonly, setNodes, scheduleChange, applyMindMapLayout]
  );

  /** Add sibling after a mind map node. */
  const handleMindMapAddSibling = useCallback(
    (nodeId: string) => {
      if (readonly) return;
      let newSiblingId = '';
      setNodes((nds) => {
        const node = nds.find((n) => n.id === nodeId) as MindMapCanvasNode | undefined;
        if (!node || node.data.type !== 'mindmap' || node.data.isRoot) return nds;

        const parentId = node.data.parentNodeId;
        if (!parentId) return nds;

        const branchColor = node.data.branchColor || getBranchColorForNewChild(parentId, nds);
        const siblingId = generateNodeId();
        newSiblingId = siblingId;

        // Insert sibling after current node in parent's children
        const updatedNds = nds.map((n) => {
          if (n.id === parentId && n.data.type === 'mindmap') {
            const parentData = n.data as MindMapNodeData;
            const idx = parentData.children.indexOf(nodeId);
            const newChildren = [...parentData.children];
            newChildren.splice(idx + 1, 0, siblingId);
            return { ...n, data: { ...n.data, children: newChildren } } as CanvasNode;
          }
          return n;
        }) as CanvasNode[];

        // Inherit direction from root
        const rootId = findMindMapRoot(nodeId, nds);
        const rootNode = rootId ? nds.find((n) => n.id === rootId) as MindMapCanvasNode | undefined : undefined;
        const direction = rootNode ? (rootNode.data as MindMapNodeData).direction : undefined;

        const newSibling: MindMapCanvasNode = {
          id: siblingId,
          type: 'mindmap',
          position: { x: node.position.x, y: node.position.y + 50 },
          data: {
            type: 'mindmap',
            label: 'New idea',
            mindmapId: node.data.mindmapId,
            parentNodeId: parentId,
            children: [],
            branchColor,
            ...(direction ? { direction } : {}),
          },
          draggable: false,
          selectable: true,
        };

        const withSibling = [...updatedNds, newSibling] as CanvasNode[];
        const layoutRootId = rootId ?? findMindMapRoot(nodeId, withSibling);
        if (!layoutRootId) return withSibling;

        const { nodes: laid } = applyMindMapLayout(layoutRootId, withSibling);
        scheduleChange(laid);
        return laid;
      });
      if (newSiblingId) setEditingNodeId(newSiblingId);
    },
    [readonly, setNodes, scheduleChange, applyMindMapLayout]
  );

  /** Delete a mind map node and its entire subtree. */
  const handleMindMapDeleteNode = useCallback(
    (nodeId: string) => {
      if (readonly) return;
      setNodes((nds) => {
        const node = nds.find((n) => n.id === nodeId) as MindMapCanvasNode | undefined;
        if (!node || node.data.type !== 'mindmap' || node.data.isRoot) return nds;

        const descendants = collectDescendants(nodeId, nds);

        // Remove from parent's children
        const cleaned = nds
          .filter((n) => !descendants.has(n.id))
          .map((n) => {
            if (n.data.type === 'mindmap' && (n.data as MindMapNodeData).children.includes(nodeId)) {
              return {
                ...n,
                data: {
                  ...n.data,
                  children: (n.data as MindMapNodeData).children.filter((c) => c !== nodeId),
                },
              } as CanvasNode;
            }
            return n;
          }) as CanvasNode[];

        const rootId = findMindMapRoot(node.data.parentNodeId || '', cleaned);
        if (!rootId) {
          scheduleChange(cleaned);
          return cleaned;
        }

        const { nodes: laid } = applyMindMapLayout(rootId, cleaned);
        scheduleChange(laid);
        return laid;
      });
    },
    [readonly, setNodes, scheduleChange, applyMindMapLayout]
  );

  /** Toggle collapse on a mind map node. */
  const handleMindMapToggleCollapse = useCallback(
    (nodeId: string) => {
      if (readonly) return;
      setNodes((nds) => {
        const node = nds.find((n) => n.id === nodeId) as MindMapCanvasNode | undefined;
        if (!node || node.data.type !== 'mindmap') return nds;

        const updatedNds = nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: { ...n.data, collapsed: !node.data.collapsed },
            } as CanvasNode;
          }
          return n;
        }) as CanvasNode[];

        const rootId = findMindMapRoot(nodeId, updatedNds);
        if (!rootId) {
          scheduleChange(updatedNds);
          return updatedNds;
        }

        const { nodes: laid } = applyMindMapLayout(rootId, updatedNds);
        scheduleChange(laid);
        return laid;
      });
    },
    [readonly, setNodes, scheduleChange, applyMindMapLayout]
  );

  /** Update a mind map node label. */
  const handleMindMapLabelChange = useCallback(
    (nodeId: string, label: string) => {
      if (readonly) return;
      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id === nodeId && n.data.type === 'mindmap') {
            return { ...n, data: { ...n.data, label } };
          }
          return n;
        }) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, readonly, scheduleChange]
  );

  /** Rotate the layout direction of a mind map (cycles right -> down -> left -> up). */
  const handleMindMapRotate = useCallback(
    (nodeId: string) => {
      if (readonly) return;
      setNodes((nds) => {
        const rootId = findMindMapRoot(nodeId, nds);
        if (!rootId) return nds;

        const rootNode = nds.find((n) => n.id === rootId) as MindMapCanvasNode | undefined;
        if (!rootNode) return nds;

        const currentDir = (rootNode.data as MindMapNodeData).direction || 'right';
        const dirs: Array<'right' | 'down' | 'left' | 'up'> = ['right', 'down', 'left', 'up'];
        const nextDir = dirs[(dirs.indexOf(currentDir) + 1) % dirs.length];

        // Update direction on all nodes in this mindmap
        const mmId = rootNode.data.mindmapId;
        const mmNodeIds: string[] = [];
        const updated = nds.map((n) => {
          if (n.data.type === 'mindmap' && (n.data as MindMapNodeData).mindmapId === mmId) {
            mmNodeIds.push(n.id);
            return { ...n, data: { ...n.data, direction: nextDir } } as CanvasNode;
          }
          return n;
        }) as CanvasNode[];

        const { nodes: laid } = applyMindMapLayout(rootId, updated);
        scheduleChange(laid);

        // Tell React Flow to re-read handle positions after the DOM updates
        requestAnimationFrame(() => {
          for (const nId of mmNodeIds) {
            updateNodeInternals(nId);
          }
        });

        return laid;
      });
    },
    [readonly, setNodes, scheduleChange, applyMindMapLayout, updateNodeInternals]
  );

  // Handle content picker selection
  const handleContentPickerSelect = useCallback(
    (result: SearchResultItem) => {
      if (readonly) return;
      const position = getCenterPosition();
      const parsed = parseUrn(result.urn);
      const defaults = getStyleDefaults();

      if (parsed.type === UrnType.NOTE) {
        const newNode: NoteCanvasNode = {
          id: generateNodeId(),
          type: 'note',
          position,
          data: { type: 'note', noteId: parsed.id, title: result.title, urn: result.urn, ...defaults },
          style: { width: 280, height: 200 },
        };
        setNodes((nds) => {
          const updated = [...nds, newNode] as CanvasNode[];
          scheduleChange(updated);
          return updated;
        });
      } else if (parsed.type === UrnType.FILE) {
        const mime = result.metadata?.mime_type || result.metadata?.mimeType || '';
        const newNode: MediaCanvasNode = {
          id: generateNodeId(),
          type: 'media',
          position,
          data: { type: 'media', fileId: parsed.id, mimeType: mime, filename: result.title, ...defaults },
          style: { width: 320, height: 240 },
        };
        setNodes((nds) => {
          const updated = [...nds, newNode] as CanvasNode[];
          scheduleChange(updated);
          return updated;
        });
      } else {
        // For any other content type, insert as a text block with a mention link
        const mentionMarkdown = `[[[${result.title}|${result.urn}]]]`;
        const newNode: TextCanvasNode = {
          id: generateNodeId(),
          type: 'text',
          position,
          data: { type: 'text', content: mentionMarkdown, ...defaults },
          style: { width: 300, height: 100 },
        };
        setNodes((nds) => {
          const updated = [...nds, newNode] as CanvasNode[];
          scheduleChange(updated);
          return updated;
        });
      }
    },
    [readonly, getCenterPosition, getStyleDefaults, setNodes, scheduleChange]
  );

  // Context menu
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      if (readonly) return;
      event.preventDefault();
      let mindMapInfo: ContextMenuState['mindMapInfo'];
      if (node.data.type === 'mindmap') {
        const mmData = node.data as MindMapNodeData;
        mindMapInfo = {
          isRoot: mmData.isRoot === true,
          hasChildren: mmData.children.length > 0,
          isCollapsed: mmData.collapsed === true,
          branchColor: mmData.branchColor || '',
          direction: mmData.direction || 'right',
        };
      }
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, mindMapInfo });
    },
    [readonly]
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    setSelectedEdge(null);
  }, []);

  // Delete node
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.filter((n) => n.id !== nodeId) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, scheduleChange]
  );

  // Node ordering (z-index)
  const handleBringToFront = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const maxZ = Math.max(...nds.map((n) => n.zIndex ?? 0));
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: maxZ + 1 } : n
        ) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, scheduleChange]
  );

  const handleSendToBack = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const minZ = Math.min(...nds.map((n) => n.zIndex ?? 0));
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: minZ - 1 } : n
        ) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, scheduleChange]
  );

  const handleBringForward = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const node = nds.find((n) => n.id === nodeId);
        if (!node) return nds;
        const currentZ = node.zIndex ?? 0;
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: currentZ + 1 } : n
        ) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, scheduleChange]
  );

  const handleSendBackward = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const node = nds.find((n) => n.id === nodeId);
        if (!node) return nds;
        const currentZ = node.zIndex ?? 0;
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: currentZ - 1 } : n
        ) as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, scheduleChange]
  );

  // Duplicate node
  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const source = nds.find((n) => n.id === nodeId);
        if (!source) return nds;

        const duplicate = {
          ...source,
          id: generateNodeId(),
          position: { x: source.position.x + 30, y: source.position.y + 30 },
          data: { ...source.data },
          selected: false,
        } as CanvasNode;

        const updated = [...nds, duplicate] as CanvasNode[];
        scheduleChange(updated);
        return updated;
      });
    },
    [setNodes, scheduleChange]
  );

  // Undo/Redo
  const handleUndo = useCallback(() => {
    const current: CanvasState = {
      ...canvasStateRef.current,
      nodes,
      edges,
    };
    const previous = undo(current);
    if (previous) {
      setNodes(previous.nodes);
      setEdges(previous.edges);
      onChange(previous);
    }
  }, [nodes, edges, undo, setNodes, setEdges, onChange]);

  const handleRedo = useCallback(() => {
    const current: CanvasState = {
      ...canvasStateRef.current,
      nodes,
      edges,
    };
    const next = redo(current);
    if (next) {
      setNodes(next.nodes);
      setEdges(next.edges);
      onChange(next);
    }
  }, [nodes, edges, redo, setNodes, setEdges, onChange]);

  // Keyboard shortcuts
  useEffect(() => {
    if (readonly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if (e.key === 't' || e.key === 'T') {
        if (!isCtrlOrMeta) {
          e.preventDefault();
          handleAddTextBlock();
        }
      } else if (e.key === 's' || e.key === 'S') {
        if (!isCtrlOrMeta) {
          e.preventDefault();
          handleAddShape('rect');
        }
      } else if (e.key === 'z' && isCtrlOrMeta && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key === 'z' && isCtrlOrMeta && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (e.key === '=' && isCtrlOrMeta && e.shiftKey) {
        e.preventDefault();
        fitView({ duration: 300 });
      } else if (e.key === '@') {
        e.preventDefault();
        setShowContentPicker(true);
      }

      // Mind map shortcuts (only when a mindmap node is selected)
      const selectedNode = nodes.find((n) => n.selected);
      if (selectedNode?.data.type === 'mindmap') {
        const mmData = selectedNode.data as MindMapNodeData;
        if (e.key === 'Tab') {
          e.preventDefault();
          handleMindMapAddChild(selectedNode.id);
        } else if (e.key === 'Enter' && !mmData.isRoot) {
          e.preventDefault();
          handleMindMapAddSibling(selectedNode.id);
        } else if (e.key === ' ' && mmData.children.length > 0) {
          e.preventDefault();
          handleMindMapToggleCollapse(selectedNode.id);
        } else if (e.key === 'F2') {
          e.preventDefault();
          setEditingNodeId(selectedNode.id);
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mmData.isRoot) {
          e.preventDefault();
          handleMindMapDeleteNode(selectedNode.id);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [readonly, handleAddTextBlock, handleAddShape, handleUndo, handleRedo, fitView, nodes, handleMindMapAddChild, handleMindMapAddSibling, handleMindMapToggleCollapse, handleMindMapDeleteNode]);

  // Focus content picker input when opened, close on escape/click outside
  useEffect(() => {
    if (!showContentPicker) return;
    const timer = setTimeout(() => contentPickerInputRef.current?.focus(), 10);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowContentPicker(false);
        clearPickerResults();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (contentPickerRef.current && !contentPickerRef.current.contains(e.target as Node)) {
        setShowContentPicker(false);
        clearPickerResults();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showContentPicker, clearPickerResults]);

  const callbacksValue = useMemo(
    () => ({
      onTextContentChange: handleTextContentChange,
      onShapeLabelChange: handleShapeLabelChange,
      onNodeStyleChange: handleNodeStyleChange,
      onMindMapLabelChange: handleMindMapLabelChange,
      onMindMapAddChild: handleMindMapAddChild,
      onMindMapAddSibling: handleMindMapAddSibling,
      onMindMapDeleteNode: handleMindMapDeleteNode,
      onMindMapToggleCollapse: handleMindMapToggleCollapse,
      readonly,
      contentId,
      editingNodeId,
      clearEditingNodeId,
    }),
    [handleTextContentChange, handleShapeLabelChange, handleNodeStyleChange, handleMindMapLabelChange, handleMindMapAddChild, handleMindMapAddSibling, handleMindMapDeleteNode, handleMindMapToggleCollapse, readonly, contentId, editingNodeId, clearEditingNodeId]
  );

  return (
    <CanvasCallbacksContext.Provider value={callbacksValue}>
      <div className={cn('relative w-full h-full bg-card')}>
        <ReactFlow
          nodes={nodes}
          edges={allEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={{ type: 'custom' }}
          defaultViewport={canvasState.viewport}
          fitView={canvasState.nodes.length > 0 && !canvasState.viewport.zoom}
          nodesDraggable={!readonly}
          nodesConnectable={!readonly}
          elementsSelectable={!readonly}
          panOnDrag
          panOnScroll
          zoomOnScroll
          minZoom={0.1}
          maxZoom={4}
          deleteKeyCode="Delete"
          colorMode={resolvedTheme}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>

        {/* Toolbar */}
        {!readonly && (
          <CanvasToolbar
            onAddTextBlock={handleAddTextBlock}
            onOpenContentPicker={() => setShowContentPicker(true)}
            onAddMediaFile={handleAddMediaFile}
            onAddShape={handleAddShape}
            onAddMindMap={handleAddMindMap}
            canvasDefaults={canvasState.defaults}
            onDefaultsChange={handleDefaultsChange}
          />
        )}

        {/* Edge style toolbar */}
        {selectedEdge && (
          <EdgeStyleToolbar
            x={selectedEdge.x}
            y={selectedEdge.y}
            edgeData={edges.find((e) => e.id === selectedEdge.edgeId)?.data}
            onStyleChange={(updates) => handleEdgeStyleChange(selectedEdge.edgeId, updates)}
            onClose={() => setSelectedEdge(null)}
          />
        )}

        {/* Context menu */}
        {contextMenu && (
          <CanvasContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            nodeId={contextMenu.nodeId}
            onClose={() => setContextMenu(null)}
            onDelete={handleDeleteNode}
            onDuplicate={handleDuplicateNode}
            onBringToFront={handleBringToFront}
            onSendToBack={handleSendToBack}
            onBringForward={handleBringForward}
            onSendBackward={handleSendBackward}
            mindMapInfo={contextMenu.mindMapInfo ? {
              ...contextMenu.mindMapInfo,
              onAddChild: handleMindMapAddChild,
              onAddSibling: handleMindMapAddSibling,
              onToggleCollapse: handleMindMapToggleCollapse,
              onDeleteSubtree: handleMindMapDeleteNode,
              onBranchColorChange: (color: string) => handleNodeStyleChange(contextMenu.nodeId, { branchColor: color }),
              onRotate: () => handleMindMapRotate(contextMenu.nodeId),
            } : undefined}
          />
        )}
        {/* Content picker */}
        {showContentPicker && (
          <>
            <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[999] animate-in fade-in-0 duration-150" />
            <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]">
              <div
                ref={contentPickerRef}
                className="w-full max-w-2xl mx-4 animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200"
              >
                <div className="rounded-2xl border-2 border-primary/50 bg-card shadow-2xl ring-4 ring-primary/10 overflow-hidden">
                  <div className="relative flex items-center border-b border-border/50">
                    <MagnifyingGlass size={20} weight="bold" className="absolute left-4 text-muted-foreground" />
                    <input
                      ref={contentPickerInputRef}
                      type="text"
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Search content to insert..."
                      className="w-full h-14 bg-transparent pl-12 pr-16 text-lg placeholder:text-muted-foreground/60 focus:outline-none"
                      autoComplete="off"
                    />
                    <div className="absolute right-4 flex items-center gap-2">
                      <kbd className="hidden sm:inline-flex px-2 py-1 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground font-mono">
                        esc
                      </kbd>
                    </div>
                  </div>

                  <SearchResultsList
                    results={pickerResults}
                    isLoading={pickerLoading}
                    query={pickerQuery}
                    onSelect={(result) => {
                      handleContentPickerSelect(result);
                      setShowContentPicker(false);
                      clearPickerResults();
                    }}
                    onClose={() => {
                      setShowContentPicker(false);
                      clearPickerResults();
                    }}
                    className="border-0 shadow-none ring-0 rounded-none max-h-[60vh]"
                    showHeader={false}
                    showFooter={false}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </CanvasCallbacksContext.Provider>
  );
}

export function CanvasEditor(props: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasEditorInner {...props} />
    </ReactFlowProvider>
  );
}
