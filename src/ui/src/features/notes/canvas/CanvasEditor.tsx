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
import { CanvasToolbar } from '@/features/notes/canvas/CanvasToolbar';
import { CanvasContextMenu } from '@/features/notes/canvas/CanvasContextMenu';
import { CustomEdge } from '@/features/notes/canvas/edges/CustomEdge';
import { EdgeStyleToolbar } from '@/features/notes/canvas/components/EdgeStyleToolbar';
import { useCanvasHistory } from '@/features/notes/canvas/hooks/useCanvasHistory';
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
} from '@/features/notes/canvas/types';
import { cn } from '@/shared/utils/cn';
import { useTheme } from '@/config/theme/ThemeProvider';
import { useAppSelector } from '@/app/hooks';
import { uploadImage } from '@/components/editor/utils/imageUploader';
import { ContentType } from '@/gen/common/v1/common_pb';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
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
}

/** Static nodeTypes -- defined outside the component to avoid re-creation. */
const NODE_TYPES: NodeTypes = {
  text: TextNode,
  note: NoteNode,
  media: MediaNode,
  shape: ShapeNode,
};

/** Static edgeTypes -- custom edge rendering for all edges. */
const EDGE_TYPES: EdgeTypes = {
  custom: CustomEdge as EdgeTypes[string],
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

  const scheduleChange = useCallback(
    (updatedNodes?: CanvasNode[], updatedEdges?: CanvasEdge[]) => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
      }
      changeTimerRef.current = setTimeout(() => {
        const currentState = canvasStateRef.current;
        const newState: CanvasState = {
          ...currentState,
          nodes: updatedNodes ?? nodes,
          edges: updatedEdges ?? edges,
        };
        pushState(currentState);
        onChange(newState);
      }, 300);
    },
    [onChange, nodes, edges, pushState]
  );

  // Handle node changes (move, resize, select)
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);

      const hasStructuralChange = changes.some(
        (c) => c.type === 'position' || c.type === 'dimensions' || c.type === 'remove'
      );
      if (hasStructuralChange && !readonly) {
        requestAnimationFrame(() => {
          scheduleChange();
        });
      }
    },
    [onNodesChange, readonly, scheduleChange]
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

  // Handle edge click to show style toolbar
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: CanvasEdge) => {
      if (readonly) return;
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
    [setNodes, readonly, scheduleChange]
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
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
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
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [readonly, handleAddTextBlock, handleAddShape, handleUndo, handleRedo, fitView]);

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
      readonly,
      contentId,
      editingNodeId,
      clearEditingNodeId,
    }),
    [handleTextContentChange, handleShapeLabelChange, handleNodeStyleChange, readonly, contentId, editingNodeId, clearEditingNodeId]
  );

  return (
    <CanvasCallbacksContext.Provider value={callbacksValue}>
      <div className={cn('relative w-full h-full bg-card')}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
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
