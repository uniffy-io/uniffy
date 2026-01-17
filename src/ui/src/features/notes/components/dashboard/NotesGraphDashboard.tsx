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
  CubeTransparentIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  ArrowsPointingOutIcon,
  DocumentTextIcon,
  UserIcon,
  FolderIcon,
  ChatBubbleLeftIcon,
  LinkIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { UrnType, urnToPath } from '@/utils/urn';
import { URN_TYPE_HEX_COLORS, URN_TYPE_LEGEND } from '@/theme/urnColors';

/** Cast NodeObject to our GraphNode type */
function asGraphNode(node: NodeObject): GraphNode {
  return node as unknown as GraphNode;
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
  const graphRef = useRef<ForceGraphMethods>();

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [themeColors, setThemeColors] = useState(getThemeColors);

  // Get notes from Redux store
  const notes = useAppSelector((state) => state.notes.notes);
  const loading = useAppSelector((state) => state.notes.loading);

  // Track theme changes
  const accentColor = useAppSelector((state) => state.theme.accentColor);
  const currentTheme = useAppSelector((state) => state.theme.currentTheme);
  const isDark = currentTheme === 'dark';

  // Update theme colors when theme changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setThemeColors(getThemeColors());
    }, 50);
    return () => clearTimeout(timer);
  }, [accentColor, currentTheme]);

  // Build graph data from notes
  const graphData = useMemo(() => {
    const notesList = Object.values(notes).filter((n) => !n.isDeleted);
    const data = buildGraphData(notesList);
    return {
      nodes: data.nodes.map((node) => ({ ...node } as NodeObject)),
      links: data.links.map((link) => ({ ...link } as LinkObject)),
    };
  }, [notes]);

  // Get graph statistics
  const stats = useMemo(() => {
    const notesList = Object.values(notes).filter((n) => !n.isDeleted);
    return getGraphStats(buildGraphData(notesList));
  }, [notes]);

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

    // Initial size
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Initial zoom to fit
  useEffect(() => {
    const timer = setTimeout(() => {
      graphRef.current?.zoomToFit(400, 80);
    }, 800);
    return () => clearTimeout(timer);
  }, [graphData.nodes.length]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    graphRef.current?.zoom(1.5, 300);
  }, []);

  const handleZoomOut = useCallback(() => {
    graphRef.current?.zoom(0.67, 300);
  }, []);

  const handleZoomFit = useCallback(() => {
    graphRef.current?.zoomToFit(400, 80);
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

  // Node hover handler
  const handleNodeHover = useCallback((node: NodeObject | null) => {
    setHoveredNode(node ? asGraphNode(node) : null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab';
    }
  }, []);

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

      // Border ring
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.strokeStyle = isHovered ? themeColors.foreground : nodeColor;
      ctx.lineWidth = isHovered ? 2 / globalScale : 1 / globalScale;
      ctx.stroke();

      // External reference indicator (dashed outer ring)
      if (!graphNode.isInternal) {
        ctx.beginPath();
        ctx.arc(x, y, size + 4 / globalScale, 0, 2 * Math.PI);
        ctx.setLineDash([4 / globalScale, 4 / globalScale]);
        ctx.strokeStyle = nodeColor + '80';
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Pinned indicator (star)
      if (graphNode.isPinned) {
        ctx.beginPath();
        ctx.arc(x + size * 0.7, y - size * 0.7, 3 / globalScale, 0, 2 * Math.PI);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
      }

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

        const textWidth = ctx.measureText(truncatedLabel).width;
        const padding = 4 / globalScale;
        const labelY = y + size + 6 / globalScale;

        // Label background pill
        const bgColor = isDark ? 'rgba(23, 23, 23, 0.9)' : 'rgba(255, 255, 255, 0.95)';
        const borderColor = isDark ? 'rgba(63, 63, 70, 0.5)' : 'rgba(212, 212, 216, 0.8)';

        ctx.beginPath();
        const pillRadius = (fontSize + padding * 2) / 2;
        const pillWidth = textWidth + padding * 3;
        ctx.roundRect(
          x - pillWidth / 2,
          labelY - padding,
          pillWidth,
          fontSize + padding * 2,
          pillRadius
        );
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 0.5 / globalScale;
        ctx.stroke();

        // Label text
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
        return DocumentTextIcon;
      case UrnType.USER:
        return UserIcon;
      case UrnType.FILE:
        return FolderIcon;
      case UrnType.CHAT:
        return ChatBubbleLeftIcon;
      default:
        return LinkIcon;
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
              <CubeTransparentIcon className="h-12 w-12 text-primary/60" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-3">Your Knowledge Graph</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Create notes and link them together using @mentions to build your personal knowledge network.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <SparklesIcon className="h-4 w-4" />
            <span>Use @mention to link content</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-gradient-to-br from-background via-background to-muted/20 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/30 rounded-xl blur-lg" />
              <div className="relative p-2.5 bg-gradient-to-br from-primary to-primary/80 rounded-xl shadow-lg">
                <CubeTransparentIcon className="h-5 w-5 text-primary-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-lg font-semibold">Knowledge Graph</h1>
              <p className="text-xs text-muted-foreground">
                {stats.totalNodes} nodes · {stats.totalLinks} connections
              </p>
            </div>
          </div>

          {/* Stats pills */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
              <DocumentTextIcon className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">{stats.internalNotes}</span>
            </div>
            {stats.externalReferences > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <LinkIcon className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {stats.externalReferences}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Graph container */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
              <div className="relative animate-spin h-10 w-10 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef as React.MutableRefObject<ForceGraphMethods | undefined>}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeId="id"
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node, color, ctx) => {
              const graphNode = asGraphNode(node);
              const size = getNodeSize(graphNode);
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x || 0, node.y || 0, size + 8, 0, 2 * Math.PI);
              ctx.fill();
            }}
            linkColor={getLinkColor}
            linkWidth={getLinkWidth}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={0.9}
            linkCurvature={0.15}
            linkDirectionalParticles={hoveredNode ? 2 : 0}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleColor={() => themeColors.primary}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            backgroundColor="transparent"
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.25}
            enableNodeDrag={true}
            enableZoomInteraction={true}
            enablePanInteraction={true}
          />
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 hover:bg-muted hover:border-border transition-all shadow-lg"
            title="Zoom in"
          >
            <MagnifyingGlassPlusIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 hover:bg-muted hover:border-border transition-all shadow-lg"
            title="Zoom out"
          >
            <MagnifyingGlassMinusIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomFit}
            className="p-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 hover:bg-muted hover:border-border transition-all shadow-lg"
            title="Fit to view"
          >
            <ArrowsPointingOutIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Hover card */}
        {hoveredNode && (
          <div className="absolute top-4 left-4 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl p-4 max-w-xs animate-in fade-in slide-in-from-left-2 duration-200">
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 shadow-inner"
                style={{
                  background: `linear-gradient(135deg, ${getNodeColor(hoveredNode)}20, ${getNodeColor(hoveredNode)}10)`,
                  borderColor: getNodeColor(hoveredNode) + '30',
                  borderWidth: 1,
                }}
              >
                {(() => {
                  const Icon = getTypeIcon(hoveredNode.type);
                  return <Icon className="h-5 w-5" style={{ color: getNodeColor(hoveredNode) }} />;
                })()}
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
                  {hoveredNode.isPinned && (
                    <span className="text-xs px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      Pinned
                    </span>
                  )}
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

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-card/80 backdrop-blur-md border border-border/50 rounded-xl shadow-xl p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {URN_TYPE_LEGEND.slice(0, 6).map((item) => (
              <div key={item.type} className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${item.tailwindBg}`}
                  style={{ boxShadow: `0 1px 2px ${item.hexColor}80` }}
                />
                <span className="text-muted-foreground">{item.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-muted-foreground/50" />
              <span className="text-muted-foreground">External</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
