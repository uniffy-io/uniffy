/**
 * Notes Graph Dashboard
 *
 * Interactive force-directed graph visualization showing connections
 * between notes based on URN mentions.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { useAppSelector } from '@/app/hooks';
import {
  buildGraphData,
  getNodeSize,
  getGraphStats,
  type GraphNode,
} from '../../utils/notesGraphUtils';
import {
  Cube,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowsOutSimple,
  FileText,
  User,
  Folder,
  ChatTeardrop,
  Link,
} from '@phosphor-icons/react';
import { getIconComponent } from '../../utils/noteIconConstants';
import { drawIconOnCanvas } from '../../utils/noteIcons';
import { UrnType, urnToPath, parseUrn } from '@/utils/urn';
import { URN_TYPE_HEX_COLORS } from '@/theme/urnColors';
import { useUrnResolution } from '@/features/search';
import { useTheme } from '@/theme/ThemeProvider';

/** Cast NodeObject to our GraphNode type */
function asGraphNode(node: NodeObject): GraphNode {
  return node as unknown as GraphNode;
}


/**
 * Draw a type-specific icon inside a node circle
 * Icons match Heroicons 24/outline style - thin strokes, geometric shapes
 */
function drawNodeIcon(
  ctx: CanvasRenderingContext2D,
  type: UrnType | 'note',
  x: number,
  y: number,
  size: number,
  color: string
) {
  const s = size * 0.35; // Icon takes up ~35% of node radius
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.05; // Very thin lines like Heroicons outline
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.translate(x, y);

  switch (type) {
    case 'note':
    case UrnType.NOTE: {
      // DocumentTextIcon - document with text lines
      const w = s * 0.75;
      const h = s;
      const fold = s * 0.22;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + fold);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      ctx.stroke();
      // Fold line
      ctx.beginPath();
      ctx.moveTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2 - fold, -h / 2 + fold);
      ctx.lineTo(w / 2, -h / 2 + fold);
      ctx.stroke();
      // Text lines
      ctx.beginPath();
      ctx.moveTo(-w / 3, h * 0.05);
      ctx.lineTo(w / 3, h * 0.05);
      ctx.moveTo(-w / 3, h * 0.25);
      ctx.lineTo(w / 3, h * 0.25);
      ctx.stroke();
      break;
    }

    case UrnType.USER: {
      // UserIcon - circle head + shoulders arc
      const headR = s * 0.3;
      ctx.beginPath();
      ctx.arc(0, -s * 0.25, headR, 0, 2 * Math.PI);
      ctx.stroke();
      // Shoulders
      ctx.beginPath();
      ctx.arc(0, s * 0.85, s * 0.55, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      break;
    }

    case UrnType.CHAT: {
      // ChatBubbleLeftIcon - speech bubble
      const w = s * 0.9;
      const h = s * 0.7;
      const r = s * 0.15;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2 - s * 0.08, w, h, r);
      ctx.stroke();
      // Tail pointing down-left
      ctx.beginPath();
      ctx.moveTo(-w * 0.25, h / 2 - s * 0.08);
      ctx.lineTo(-w * 0.35, h / 2 + s * 0.18);
      ctx.lineTo(-w * 0.05, h / 2 - s * 0.08);
      ctx.stroke();
      break;
    }

    case UrnType.FILE: {
      // FolderIcon - folder shape
      const w = s * 0.9;
      const h = s * 0.7;
      const tabW = w * 0.35;
      const tabH = h * 0.2;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 + tabH);
      ctx.lineTo(-w / 2, h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(w / 2, -h / 2 + tabH);
      ctx.lineTo(-w / 2 + tabW + tabH, -h / 2 + tabH);
      ctx.lineTo(-w / 2 + tabW, -h / 2);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.closePath();
      ctx.stroke();
      break;
    }

    case UrnType.CALENDAR_EVENT: {
      // CalendarIcon - calendar with top hooks
      const w = s * 0.8;
      const h = s * 0.85;
      const r = s * 0.1;
      // Main rectangle
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2 + h * 0.12, w, h * 0.8, r);
      ctx.stroke();
      // Top hooks
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, -h / 2 + h * 0.12);
      ctx.lineTo(-w * 0.28, -h / 2);
      ctx.moveTo(w * 0.28, -h / 2 + h * 0.12);
      ctx.lineTo(w * 0.28, -h / 2);
      ctx.stroke();
      // Header line
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.08);
      ctx.lineTo(w / 2, -h * 0.08);
      ctx.stroke();
      break;
    }

    default: {
      // LinkIcon - chain link for unknown types
      const linkR = s * 0.22;
      const gap = s * 0.15;
      ctx.beginPath();
      ctx.arc(-gap, -gap * 0.5, linkR, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gap, gap * 0.5, linkR, Math.PI * 1.75, Math.PI * 1.25 + 2 * Math.PI);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/** Convert HSL string (from CSS var) to hex color */
function hslToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/);
  if (parts.length !== 3) return '#8b5cf6';

  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Get theme colors from CSS variables */
function getThemeColors() {
  const root = document.documentElement;
  const getVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const primaryHsl = getVar('--primary');
  const backgroundHsl = getVar('--background');
  const cardHsl = getVar('--card');
  const foregroundHsl = getVar('--foreground');
  const mutedForegroundHsl = getVar('--muted-foreground');

  return {
    primary: primaryHsl ? hslToHex(primaryHsl) : '#8b5cf6',
    background: backgroundHsl ? hslToHex(backgroundHsl) : '#0a0a0a',
    card: cardHsl ? hslToHex(cardHsl) : '#171717',
    foreground: foregroundHsl ? hslToHex(foregroundHsl) : '#fafafa',
    mutedForeground: mutedForegroundHsl ? hslToHex(mutedForegroundHsl) : '#a1a1aa',
  };
}


export function NotesGraphDashboard() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);

  // Store nodes by ID to preserve x/y positions across re-renders
  // The d3-force simulation mutates these objects to add x/y coordinates
  const nodeMapRef = useRef<Map<string, NodeObject>>(new Map());

  // WORKAROUND: Custom hit detection to bypass react-force-graph-2d color-tracking bug
  // The library's canvas-color-tracker has issues where certain node indices fail hit detection
  // We implement coordinate-based hit detection instead
  const lastHoveredNodeRef = useRef<string | null>(null);


  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [themeColors, setThemeColors] = useState(getThemeColors);

  // Get notes from Redux store (populated by NotesPage's fetchNotes dispatch)
  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const loading = useAppSelector((state) => state.notes?.loading ?? false);

  // Track theme changes
  const accentColor = useAppSelector((state) => state.theme?.accentColor);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Update theme colors when theme changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setThemeColors(getThemeColors());
    }, 50);
    return () => clearTimeout(timer);
  }, [accentColor, resolvedTheme]);

  // Collect all external URNs from notes (non-NOTE types)
  const externalUrns = useMemo(() => {
    const notesList = Object.values(notes).filter((n) => !n.isDeleted);
    const noteIds = new Set(notesList.map((n) => n.id));
    const urns = new Set<string>();

    for (const note of notesList) {
      for (const urn of note.outgoingReferences || []) {
        const parsed = parseUrn(urn);
        // Only resolve URNs that aren't internal notes
        if (parsed.isValid && !noteIds.has(parsed.id)) {
          urns.add(urn);
        }
      }
    }

    return Array.from(urns);
  }, [notes]);

  // Resolve URN metadata for external references
  const { resolved: urnMetadata } = useUrnResolution(externalUrns);

  // Build graph data from notes with URN metadata for external references
  const graphData = useMemo(() => {
    const notesList = Object.values(notes).filter((n) => !n.isDeleted);
    if (notesList.length === 0) {
      return { nodes: [] as NodeObject[], links: [] as LinkObject[] };
    }

    const data = buildGraphData(notesList, urnMetadata);

    // Preserve node positions from previous render
    // This ref access during render is intentional to maintain node positions
    // when the graph data changes (e.g., when URN metadata updates)
    /* eslint-disable react-hooks/refs */
    const existingNodes = nodeMapRef.current;
    const newNodeMap = new Map<string, NodeObject>();

    // Pre-calculate initial positions in a spiral pattern to avoid the "big bang" effect
    // This spreads nodes out before the force simulation starts
    const getInitialPosition = (index: number) => {
      // Use golden angle spiral for even distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const angle = index * goldenAngle;
      // Radius grows with sqrt to maintain roughly equal density
      const radius = Math.sqrt(index + 1) * 15;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    };

    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i];
      const existing = existingNodes.get(node.id);
      if (existing && typeof existing.x === 'number' && typeof existing.y === 'number') {
        // Preserve existing position
        node.x = existing.x;
        node.y = existing.y;
        node.vx = existing.vx;
        node.vy = existing.vy;
      } else {
        // Assign initial position in spiral pattern
        const pos = getInitialPosition(i);
        node.x = pos.x;
        node.y = pos.y;
      }
      newNodeMap.set(node.id, node as unknown as NodeObject);
    }
    nodeMapRef.current = newNodeMap;
    /* eslint-enable react-hooks/refs */

    return {
      nodes: data.nodes as unknown as NodeObject[],
      links: data.links as unknown as LinkObject[],
    };
  }, [notes, urnMetadata]);

  // Get graph statistics
  const stats = useMemo(() => {
    const notesList = Object.values(notes).filter((n) => !n.isDeleted);
    if (notesList.length === 0) {
      return { totalNodes: 0, internalNotes: 0, externalReferences: 0, totalLinks: 0, avgConnections: 0 };
    }
    const data = buildGraphData(notesList, urnMetadata);
    return getGraphStats(data);
  }, [notes, urnMetadata]);

  // Track layout and calculate dimensions based on sidebar state
  const isSidebarOpen = useAppSelector((state) => state.editor?.isSidebarOpen ?? true);

  // Handle container resize with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    // Set initial dimensions from container
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => resizeObserver.disconnect();
  }, []); // Only run once on mount

  // Update dimensions when sidebar state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height });
        }
      }
    }, 300); // Allow time for sidebar animation
    return () => clearTimeout(timer);
  }, [isSidebarOpen]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height });
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Default zoom level
  const DEFAULT_ZOOM = 3;

  // Set initial zoom and center once on mount
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || !graphRef.current || !dimensions || graphData.nodes.length === 0) return;
    hasInitialized.current = true;

    // Wait for graph to render, then set default zoom centered at origin
    const timer = setTimeout(() => {
      graphRef.current?.zoom(DEFAULT_ZOOM, 0);
      graphRef.current?.centerAt(0, 0, 0);
    }, 100);

    return () => clearTimeout(timer);
  }, [graphData.nodes.length, dimensions]);

  // Cleanup: pause animation immediately on unmount to prevent navigation delays
  useEffect(() => {
    // Capture ref value inside effect to avoid stale reference in cleanup
    const graph = graphRef.current;
    return () => {
      graph?.pauseAnimation();
    };
  }, []);

  // Zoom controls - get current zoom and multiply
  const handleZoomIn = useCallback(() => {
    if (!graphRef.current) return;
    const p1 = graphRef.current.screen2GraphCoords(0, 0);
    const p2 = graphRef.current.screen2GraphCoords(100, 0);
    if (!p1 || !p2) return;
    const currentZoom = 100 / Math.abs(p2.x - p1.x);
    graphRef.current.zoom(currentZoom * 1.5, 300);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!graphRef.current) return;
    const p1 = graphRef.current.screen2GraphCoords(0, 0);
    const p2 = graphRef.current.screen2GraphCoords(100, 0);
    if (!p1 || !p2) return;
    const currentZoom = 100 / Math.abs(p2.x - p1.x);
    graphRef.current.zoom(currentZoom * 0.67, 300);
  }, []);

  const handleZoomFit = useCallback(() => {
    graphRef.current?.zoomToFit(400, 100);
  }, []);

  // Node click handler - navigate to the appropriate page for any node type
  const handleNodeClick = useCallback(
    (node: NodeObject) => {
      const graphNode = asGraphNode(node);

      if (graphNode.isInternal) {
        // Internal notes - navigate directly
        navigate(`/notes/${graphNode.id}`);
      } else if (graphNode.urn) {
        // External references - use urnToPath for proper routing
        const path = urnToPath(graphNode.urn);
        if (path !== '#') {
          navigate(path);
        }
      }
    },
    [navigate]
  );

  // WORKAROUND: Custom hit detection to bypass library bug
  // Find node at screen coordinates using graph's coordinate transformation
  const findNodeAtPosition = useCallback(
    (screenX: number, screenY: number): NodeObject | null => {
      if (!graphRef.current || !containerRef.current) return null;

      // Get container bounds
      const rect = containerRef.current.getBoundingClientRect();
      const x = screenX - rect.left;
      const y = screenY - rect.top;

      // Convert screen coords to graph coords using the graph's transformation
      const graphCoords = graphRef.current.screen2GraphCoords(x, y);
      if (!graphCoords) return null;

      const hitRadius = 15; // Pixels in graph coordinates for hit testing

      // Find the closest node within hit radius
      let closestNode: NodeObject | null = null;
      let closestDist = Infinity;

      for (const node of graphData.nodes) {
        if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;

        const dx = graphCoords.x - node.x;
        const dy = graphCoords.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < hitRadius && dist < closestDist) {
          closestDist = dist;
          closestNode = node;
        }
      }

      return closestNode;
    },
    [graphData.nodes]
  );

  // Custom mouse move handler for hover detection
  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      const node = findNodeAtPosition(e.clientX, e.clientY);
      const nodeId = node ? asGraphNode(node).id : null;

      // Only update if hover state changed
      if (nodeId !== lastHoveredNodeRef.current) {
        lastHoveredNodeRef.current = nodeId;

        if (node) {
          setHoveredNode(asGraphNode(node));
          if (containerRef.current) {
            containerRef.current.style.cursor = 'pointer';
          }
        } else {
          setHoveredNode(null);
          if (containerRef.current) {
            containerRef.current.style.cursor = 'grab';
          }
        }
      }
    },
    [findNodeAtPosition]
  );

  // Custom click handler
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      const node = findNodeAtPosition(e.clientX, e.clientY);
      if (node) {
        handleNodeClick(node);
      }
    },
    [findNodeAtPosition, handleNodeClick]
  );

  // Attach custom mouse handlers to bypass library's broken hit detection
  useEffect(() => {
    if (!containerRef.current || loading) return;

    // Use MutationObserver to wait for canvas to be rendered
    let canvas = containerRef.current.querySelector('canvas');

    const attachHandlers = (canvasEl: HTMLCanvasElement) => {
      canvasEl.addEventListener('mousemove', handleCanvasMouseMove);
      canvasEl.addEventListener('click', handleCanvasClick);
    };

    const detachHandlers = (canvasEl: HTMLCanvasElement) => {
      canvasEl.removeEventListener('mousemove', handleCanvasMouseMove);
      canvasEl.removeEventListener('click', handleCanvasClick);
    };

    if (canvas) {
      attachHandlers(canvas);
    }

    // Observe for canvas being added if not present yet
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLCanvasElement) {
            canvas = node;
            attachHandlers(canvas);
          }
        }
      }
    });

    observer.observe(containerRef.current, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (canvas) {
        detachHandlers(canvas);
      }
    };
  }, [handleCanvasMouseMove, handleCanvasClick, loading]);

  // Get node color based on type
  const getNodeColor = useCallback(
    (node: GraphNode): string => {
      if (node.isInternal) {
        return themeColors.primary;
      }
      return URN_TYPE_HEX_COLORS[node.type as UrnType] || URN_TYPE_HEX_COLORS[UrnType.UNKNOWN];
    },
    [themeColors.primary]
  );

  // Custom node painting with glow effects
  const paintNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const graphNode = asGraphNode(node);
      const size = getNodeSize(graphNode);
      const isHovered = hoveredNode?.id === graphNode.id;
      const nodeColor = getNodeColor(graphNode);
      const x = node.x || 0;
      const y = node.y || 0;

      // Outer glow for hovered nodes
      if (isHovered) {
        const gradient = ctx.createRadialGradient(x, y, size, x, y, size * 3);
        gradient.addColorStop(0, nodeColor + '40');
        gradient.addColorStop(1, nodeColor + '00');
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Node shadow
      ctx.shadowColor = nodeColor + '60';
      ctx.shadowBlur = isHovered ? 20 : 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Main node circle with gradient
      const nodeGradient = ctx.createRadialGradient(
        x - size * 0.3,
        y - size * 0.3,
        0,
        x,
        y,
        size
      );
      nodeGradient.addColorStop(0, nodeColor);
      nodeGradient.addColorStop(1, nodeColor + 'cc');

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = nodeGradient;
      ctx.fill();

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Draw icon inside the node
      const iconColor = isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.95)';

      if (graphNode.customIcon) {
        if (graphNode.customIcon.type === 'emoji') {
          // Draw custom emoji icon - sized to match heroicons (~70% of node)
          const emojiSize = size * 0.65;
          ctx.font = `${emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Small vertical offset to visually center (emojis tend to sit high)
          ctx.fillText(graphNode.customIcon.value, x, y + emojiSize * 0.08);
        } else {
          // Draw custom heroicon using SVG path data
          const iconSize = size * 0.7; // Icon takes up ~70% of node size
          const drawn = drawIconOnCanvas(ctx, graphNode.customIcon.value, x, y, iconSize, iconColor);
          if (!drawn) {
            // Fallback to default icon if heroicon not found
            drawNodeIcon(ctx, 'note', x, y, size, iconColor);
          }
        }
      } else {
        // Draw default type icon using canvas paths
        drawNodeIcon(ctx, graphNode.type, x, y, size, iconColor);
      }

      // Border ring (consistent for all nodes)
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.strokeStyle = isHovered ? themeColors.foreground : nodeColor;
      ctx.lineWidth = isHovered ? 2 / globalScale : 1 / globalScale;
      ctx.stroke();

      // Label (only when zoomed in enough or hovered)
      if (globalScale > 0.6 || isHovered) {
        const fontSize = Math.max(11 / globalScale, 4);
        const label = graphNode.label;
        const maxLength = isHovered ? 30 : 18;
        const truncatedLabel =
          label.length > maxLength ? label.slice(0, maxLength) + '…' : label;

        ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelY = y + size + 6 / globalScale;

        // Label text - white on dark, dark on light
        ctx.fillStyle = isDark ? themeColors.foreground : '#18181b';
        ctx.fillText(truncatedLabel, x, labelY);
      }
    },
    [hoveredNode, getNodeColor, themeColors, isDark]
  );

  // Link styling
  const getLinkColor = useCallback(
    (link: LinkObject) => {
      const sourceId =
        typeof link.source === 'object' ? (link.source as NodeObject).id : link.source;
      const targetId =
        typeof link.target === 'object' ? (link.target as NodeObject).id : link.target;

      if (hoveredNode) {
        if (hoveredNode.id === sourceId || hoveredNode.id === targetId) {
          return themeColors.primary + 'cc';
        }
        return isDark ? 'rgba(63, 63, 70, 0.15)' : 'rgba(161, 161, 170, 0.15)';
      }
      return isDark ? 'rgba(113, 113, 122, 0.35)' : 'rgba(161, 161, 170, 0.4)';
    },
    [hoveredNode, themeColors.primary, isDark]
  );

  const getLinkWidth = useCallback(
    (link: LinkObject) => {
      const sourceId =
        typeof link.source === 'object' ? (link.source as NodeObject).id : link.source;
      const targetId =
        typeof link.target === 'object' ? (link.target as NodeObject).id : link.target;

      if (hoveredNode && (hoveredNode.id === sourceId || hoveredNode.id === targetId)) {
        return 2;
      }
      return 1;
    },
    [hoveredNode]
  );

  // Get icon for node type
  const getTypeIcon = (type: UrnType | 'note') => {
    switch (type) {
      case 'note':
      case UrnType.NOTE:
        return FileText;
      case UrnType.USER:
        return User;
      case UrnType.FILE:
        return Folder;
      case UrnType.CHAT:
        return ChatTeardrop;
      default:
        return Link;
    }
  };

  // Empty state
  if (!loading && graphData.nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-background to-muted/30">
        <div className="text-center p-8 max-w-md">
          <div className="relative mx-auto w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
            <div className="relative w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 rounded-full flex items-center justify-center border border-primary/20">
              <Cube size={48} weight="duotone" className="text-primary/60" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-3">Your Knowledge Graph</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Create notes and link them together using @mentions to build your personal knowledge network.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-gradient-to-br from-background via-background to-muted/20 overflow-hidden">
      {/* Graph container */}
      <div ref={containerRef} className="flex-1 relative min-h-0 w-full">
        {loading || !dimensions ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
              <div className="relative animate-spin h-10 w-10 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          </div>
        ) : (
          <ForceGraph2D
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={graphRef as any}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeId="id"
            nodeLabel=""
            nodeCanvasObject={paintNode}
            nodeCanvasObjectMode={() => 'replace'}
            linkColor={getLinkColor}
            linkWidth={getLinkWidth}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.005}
            linkDirectionalParticleColor={() => themeColors.primary + 'cc'}
            // WORKAROUND: Disable library's broken hover/click detection
            // (canvas-color-tracker bug where certain node indices fail hit detection)
            // We use our own coordinate-based hit detection instead
            enablePointerInteraction={false}
            // No warmupTicks - render immediately and let simulation animate visually
            // This prevents the jarring "half render then jump" behavior with many nodes
            warmupTicks={0}
            cooldownTicks={150}
            cooldownTime={1500}
            d3AlphaDecay={0.025}
            d3VelocityDecay={0.35}
            minZoom={0.1}
            maxZoom={10}
            backgroundColor="transparent"
          />
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 pointer-events-auto">
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 hover:bg-muted hover:border-border transition-all shadow-lg"
            title="Zoom in"
          >
            <MagnifyingGlassPlus size={16} weight="bold" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 hover:bg-muted hover:border-border transition-all shadow-lg"
            title="Zoom out"
          >
            <MagnifyingGlassMinus size={16} weight="bold" />
          </button>
          <button
            onClick={handleZoomFit}
            className="p-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 hover:bg-muted hover:border-border transition-all shadow-lg"
            title="Fit to view"
          >
            <ArrowsOutSimple size={16} weight="bold" />
          </button>
        </div>

        {/* Hover card */}
        {hoveredNode && (
          <div className="absolute top-4 left-4 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl p-4 max-w-xs animate-in fade-in slide-in-from-left-2 duration-200 pointer-events-none">
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 shadow-inner"
                style={{
                  background: `linear-gradient(135deg, ${getNodeColor(hoveredNode)}20, ${getNodeColor(hoveredNode)}10)`,
                  borderColor: getNodeColor(hoveredNode) + '30',
                  borderWidth: 1,
                }}
              >
                {hoveredNode.customIcon ? (
                  hoveredNode.customIcon.type === 'emoji' ? (
                    <span className="text-xl">{hoveredNode.customIcon.value}</span>
                  ) : (
                    (() => {
                      const Icon = getIconComponent(hoveredNode.customIcon.value);
                      return <Icon size={20} weight="duotone" style={{ color: getNodeColor(hoveredNode) }} />;
                    })()
                  )
                ) : (
                  (() => {
                    const Icon = getTypeIcon(hoveredNode.type);
                    return <Icon size={20} weight="duotone" style={{ color: getNodeColor(hoveredNode) }} />;
                  })()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate">{hoveredNode.label}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-md capitalize"
                    style={{
                      backgroundColor: getNodeColor(hoveredNode) + '15',
                      color: getNodeColor(hoveredNode),
                    }}
                  >
                    {hoveredNode.isInternal ? 'Note' : hoveredNode.type.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {hoveredNode.connections} connection{hoveredNode.connections !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            {(hoveredNode.isInternal || (hoveredNode.urn && urnToPath(hoveredNode.urn) !== '#')) && (
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-1.5 text-xs text-muted-foreground">
                <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Click</kbd>
                <span>to open</span>
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="absolute top-4 left-4 flex items-center gap-2 text-xs text-muted-foreground pointer-events-none">
          <span>{stats.totalNodes} nodes</span>
          <span>·</span>
          <span>{stats.totalLinks} links</span>
        </div>

      </div>
    </div>
  );
}
