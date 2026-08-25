/** Interactive force-directed graph of URN mention connections across the org's content. */

import { createElement, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useNavigate, useSearchParams } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, NodeObject, LinkObject } from "react-force-graph-2d";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import {
  buildGraphData,
  getNodeSize,
  type GraphNode,
} from "@/features/library/utils/knowledgeGraphUtils";
import {
  Cube,
  WarningCircle,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowsOutSimple,
  X,
} from "@phosphor-icons/react";
import { fetchContentGraph, type SerializedGraphEdge } from "@/features/library/store/graphSlice";
import { GraphNodeDetails } from "@/features/library/components/GraphNodeDetails";
import { UrnType, urnToPath } from "@/shared/utils/urn";
import { getContentTypeIcon, getContentTypeLabel } from "@/config/theme/contentTypes";
import { useSavedTypesFilter } from "@/features/bookmarks/hooks/useSavedTypesFilter";
import { brandAlpha, brandAxisColor, brandGradient } from "@/config/theme/brandGradients";
import { getUrnTypeBrandStops } from "@/config/theme/urnColors";
import { getInitials } from "@/components/subject/utils";
import { cn } from "@/shared/utils/cn";
import { useUrnResolution } from "@/features/search";
import { useTheme } from "@/config/theme/ThemeProvider";
import { GraphHitIndex } from "@/features/library/utils/graphHitIndex";

const EMPTY_GRAPH_EDGES: SerializedGraphEdge[] = [];
const GRAPH_HIT_RADIUS = 15;
const GRAPH_HIT_CELL_SIZE = GRAPH_HIT_RADIUS * 2;

function asGraphNode(node: NodeObject): GraphNode {
  return node as unknown as GraphNode;
}

function linkEndpointIds(link: LinkObject): [string, string] {
  const source = typeof link.source === "object" ? (link.source as NodeObject).id : link.source;
  const target = typeof link.target === "object" ? (link.target as NodeObject).id : link.target;
  return [String(source), String(target)];
}

/** BFS out to `depth` hops; the result includes the root. */
function neighborhoodIds(
  adjacency: Map<string, Set<string>>,
  rootId: string,
  depth: number,
): Set<string> {
  const seen = new Set([rootId]);
  let frontier = [rootId];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

interface SimulationForce {
  (alpha: number): void;
  initialize?: (nodes: NodeObject[]) => void;
}

// d3-force is not a declared dependency (it only exists transitively inside
// react-force-graph-2d), so the two extra forces are hand-rolled d3-compatible ones.

/** Circle collision keyed on the painted node radius, via a uniform spatial grid. */
function collisionForce(radiusFor: (node: NodeObject) => number): SimulationForce {
  let nodes: NodeObject[] = [];
  const force: SimulationForce = () => {
    if (nodes.length === 0) return;
    const radii = new Array<number>(nodes.length);
    let maxRadius = 0;
    for (let i = 0; i < nodes.length; i++) {
      radii[i] = radiusFor(nodes[i]);
      if (radii[i] > maxRadius) maxRadius = radii[i];
    }
    // Cell side = max diameter, so any overlapping pair (separation < ra + rb
    // <= cell side) always lands within the 3x3 neighbor window.
    const cellSize = maxRadius * 2 || 1;
    const grid = new Map<string, number[]>();
    for (let i = 0; i < nodes.length; i++) {
      const key = `${Math.floor((nodes[i].x ?? 0) / cellSize)},${Math.floor((nodes[i].y ?? 0) / cellSize)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ra = radii[i];
      const cx = Math.floor((a.x ?? 0) / cellSize);
      const cy = Math.floor((a.y ?? 0) / cellSize);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = nodes[j];
            const minDist = ra + radii[j];
            let dx = (b.x ?? 0) - (a.x ?? 0);
            let dy = (b.y ?? 0) - (a.y ?? 0);
            let distSq = dx * dx + dy * dy;
            if (distSq === 0) {
              dx = (i % 2 ? 1 : -1) * 0.5;
              dy = 0.5;
              distSq = 0.5;
            }
            if (distSq < minDist * minDist) {
              const dist = Math.sqrt(distSq);
              const push = ((minDist - dist) / dist) * 0.5;
              a.x = (a.x ?? 0) - dx * push;
              a.y = (a.y ?? 0) - dy * push;
              b.x = (b.x ?? 0) + dx * push;
              b.y = (b.y ?? 0) + dy * push;
            }
          }
        }
      }
    }
  };
  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}

/** Gentle pull toward the origin so disconnected components stay near the main cluster. */
function axisPullForce(axis: "x" | "y", strength: number): SimulationForce {
  let nodes: NodeObject[] = [];
  const force: SimulationForce = (alpha) => {
    for (const node of nodes) {
      const velocityKey = axis === "x" ? "vx" : "vy";
      node[velocityKey] = (node[velocityKey] ?? 0) - (node[axis] ?? 0) * strength * alpha;
    }
  };
  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}

const GRAPH_STALE_AFTER_MS = 5 * 60_000;

// Edges tint off the same Unity Violet axis the nodes ride, so the canvas is one
// palette rather than violet nodes on grey wiring. Dark and light differ only in
// how much of the axis survives against the background.
const GRAPH_EDGE_VIOLET = brandAxisColor(0.18);
const GRAPH_EDGE_ACTIVE = brandAxisColor(0.35);

const GRAPH_LINK_PAINT = {
  active: brandAlpha(GRAPH_EDGE_ACTIVE, 0.8),
  idleDark: brandAlpha(GRAPH_EDGE_VIOLET, 0.45),
  idleLight: brandAlpha(GRAPH_EDGE_VIOLET, 0.35),
  dimmedDark: brandAlpha(GRAPH_EDGE_VIOLET, 0.12),
  dimmedLight: brandAlpha(GRAPH_EDGE_VIOLET, 0.12),
};

const GRAPH_ARROW_PAINT = {
  active: GRAPH_EDGE_ACTIVE,
  idleDark: brandAlpha(GRAPH_EDGE_ACTIVE, 0.65),
  idleLight: brandAlpha(GRAPH_EDGE_ACTIVE, 0.6),
  dimmedDark: brandAlpha(GRAPH_EDGE_VIOLET, 0.14),
  dimmedLight: brandAlpha(GRAPH_EDGE_VIOLET, 0.14),
};

const PERSON_TYPES = new Set<UrnType>([UrnType.USER, UrnType.TEAM]);

/** Circle nodes are actors (people, teams, agents); content renders as rounded tiles. */
function isCircleNode(type: UrnType): boolean {
  return PERSON_TYPES.has(type) || type === UrnType.AGENT;
}

// The nodes reuse the exact Phosphor icons the mention chips use, rasterized
// once per type onto an Image the canvas can stamp at any zoom level.
const ICON_RASTER_SIZE = 96;
const iconImageCache = new Map<string, HTMLImageElement>();

function getIconImage(type: UrnType, color: string, onReady: () => void): HTMLImageElement {
  const key = `${type}:${color}`;
  let img = iconImageCache.get(key);
  if (!img) {
    const IconComponent = getContentTypeIcon(type);
    const svg = renderToStaticMarkup(
      createElement(IconComponent, { size: ICON_RASTER_SIZE, color, weight: "fill" }),
    );
    img = new Image(ICON_RASTER_SIZE, ICON_RASTER_SIZE);
    img.onload = onReady;
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    iconImageCache.set(key, img);
  }
  return img;
}

// measureText per labeled node per frame dominates paint cost on big graphs;
// zoom varies the font size continuously, so bucket it to one decimal.
const labelWidthCache = new Map<string, number>();

function measureLabel(ctx: CanvasRenderingContext2D, text: string, fontSize: number): number {
  const key = `${text}:${fontSize.toFixed(1)}`;
  let width = labelWidthCache.get(key);
  if (width === undefined) {
    width = ctx.measureText(text).width;
    labelWidthCache.set(key, width);
  }
  return width;
}

function traceNodeShape(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  x: number,
  y: number,
  inflate = 0,
) {
  const size = getNodeSize(node) + inflate;
  ctx.beginPath();
  if (isCircleNode(node.type)) {
    ctx.arc(x, y, size, 0, 2 * Math.PI);
  } else {
    const side = size * 1.8;
    ctx.roundRect(x - side / 2, y - side / 2, side, side, size * 0.55);
  }
}

function hslToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/);
  if (parts.length !== 3) return "#8b5cf6";

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
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getThemeColors() {
  const root = document.documentElement;
  const getVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const primaryHsl = getVar("--primary");
  const backgroundHsl = getVar("--background");
  const cardHsl = getVar("--card");
  const foregroundHsl = getVar("--foreground");
  const mutedForegroundHsl = getVar("--muted-foreground");

  return {
    primary: primaryHsl ? hslToHex(primaryHsl) : "#8b5cf6",
    background: backgroundHsl ? hslToHex(backgroundHsl) : "#0a0a0a",
    card: cardHsl ? hslToHex(cardHsl) : "#171717",
    foreground: foregroundHsl ? hslToHex(foregroundHsl) : "#fafafa",
    mutedForeground: mutedForegroundHsl ? hslToHex(mutedForegroundHsl) : "#a1a1aa",
  };
}

export function KnowledgeGraph() {
  useDocumentTitle("Knowledge Graph");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const hitIndexRef = useRef(new GraphHitIndex<NodeObject>(GRAPH_HIT_CELL_SIZE));

  // Store nodes by ID to preserve x/y positions across re-renders
  // The d3-force simulation mutates these objects to add x/y coordinates
  const nodeMapRef = useRef<Map<string, NodeObject>>(new Map());

  // The library's color tracker misses some node indices, so pointer events use painted positions.
  const lastHoveredNodeRef = useRef<string | null>(null);

  // Per-node paint alpha, lerped toward its target each frame so hover focus
  // fades instead of snapping. The library repaints every rAF, so no ticker.
  const dimAlphaRef = useRef<Map<string, number>>(new Map());

  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [themeColors, setThemeColors] = useState(getThemeColors);

  // Bumped when a rasterized icon finishes loading so the canvas repaints even
  // if the simulation already settled.
  const [, setIconEpoch] = useState(0);
  const handleIconReady = useCallback(() => setIconEpoch((epoch) => epoch + 1), []);

  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const graphState = useAppSelector((state) => state.libraryGraph);
  const graphMatchesOrganization = graphState.organizationId === organizationId;
  const edges = graphMatchesOrganization ? graphState.edges : EMPTY_GRAPH_EDGES;
  const graphStatus = graphMatchesOrganization ? graphState.status : "idle";
  const graphError = graphMatchesOrganization ? graphState.error : null;
  const graphFetchedAt = graphMatchesOrganization ? graphState.fetchedAt : null;
  const graphTruncated = graphMatchesOrganization && graphState.truncated;

  useEffect(() => {
    if (!organizationId || graphStatus !== "idle") return;
    dispatch(fetchContentGraph(organizationId));
  }, [dispatch, organizationId, graphStatus]);

  // A long-lived tab never refetches from "succeeded"; refresh stale data when
  // the user comes back to the tab. Positions survive through nodeMapRef.
  useEffect(() => {
    if (!organizationId || graphStatus !== "succeeded" || graphFetchedAt === null) return;
    const maybeRefetch = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - graphFetchedAt < GRAPH_STALE_AFTER_MS) return;
      dispatch(fetchContentGraph(organizationId));
    };
    window.addEventListener("focus", maybeRefetch);
    document.addEventListener("visibilitychange", maybeRefetch);
    return () => {
      window.removeEventListener("focus", maybeRefetch);
      document.removeEventListener("visibilitychange", maybeRefetch);
    };
  }, [dispatch, organizationId, graphStatus, graphFetchedAt]);

  // Only block the canvas before the first data arrives - a staleness refetch
  // keeps the existing graph (and its layout) on screen.
  const loading = graphStatus === "idle" || (graphStatus === "loading" && edges.length === 0);

  const accentColor = useAppSelector((state) => state.theme?.accentColor);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const timer = setTimeout(() => {
      setThemeColors(getThemeColors());
    }, 50);
    return () => clearTimeout(timer);
  }, [accentColor, resolvedTheme]);

  // Resolve titles and availability for every node in the graph
  const allUrns = useMemo(() => {
    const urns = new Set<string>();
    for (const edge of edges) {
      urns.add(edge.sourceUrn);
      urns.add(edge.targetUrn);
    }
    return Array.from(urns);
  }, [edges]);
  const { resolved: urnMetadata } = useUrnResolution(allUrns);

  // Build the full graph, then narrow it through focus and type filters
  const fullData = useMemo(() => buildGraphData(edges, urnMetadata), [edges, urnMetadata]);

  const fullAdjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of fullData.links) {
      if (link.source === link.target) continue;
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)?.add(link.target);
      map.get(link.target)?.add(link.source);
    }
    return map;
  }, [fullData]);

  const nodeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of fullData.nodes) map.set(node.id, node.label);
    return map;
  }, [fullData]);

  // Directed link maps feed the hover card's outgoing/incoming breakdown
  const linkDirections = useMemo(() => {
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const link of fullData.links) {
      if (link.source === link.target) continue;
      let out = outgoing.get(link.source);
      if (!out) outgoing.set(link.source, (out = []));
      out.push(link.target);
      let inc = incoming.get(link.target);
      if (!inc) incoming.set(link.target, (inc = []));
      inc.push(link.source);
    }
    return { incoming, outgoing };
  }, [fullData]);

  const [searchParams, setSearchParams] = useSearchParams();
  const focusParam = searchParams.get("focus");
  const focusId = useMemo(
    () => (focusParam && fullData.nodes.some((n) => n.id === focusParam) ? focusParam : null),
    [focusParam, fullData],
  );
  // "Show in graph" can point at content outside the bounded projection; dropping
  // the parameter without a word looks like the action did nothing.
  const focusMissing = !!focusParam && focusId === null && fullData.nodes.length > 0;

  const setFocus = useCallback(
    (id: string | null) => {
      setSearchParams((params) => {
        const next = new URLSearchParams(params);
        if (id) {
          next.set("focus", id);
        } else {
          next.delete("focus");
          next.delete("depth");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const depthParam = searchParams.get("depth");
  const focusDepth = depthParam === "1" || depthParam === "3" ? Number(depthParam) : 2;

  const cycleFocusDepth = useCallback(() => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      const upcoming = focusDepth === 3 ? 1 : focusDepth + 1;
      // Default depth stays out of the URL so plain focus links keep clean
      if (upcoming === 2) next.delete("depth");
      else next.set("depth", String(upcoming));
      return next;
    });
  }, [setSearchParams, focusDepth]);

  const focusIds = useMemo(
    () => (focusId ? neighborhoodIds(fullAdjacency, focusId, focusDepth) : null),
    [focusId, focusDepth, fullAdjacency],
  );

  // Type visibility rides the sidebar's shared `?types=` filter rail
  const { selected: selectedTypes } = useSavedTypesFilter();

  const graphData = useMemo(() => {
    const visibleNodes = fullData.nodes.filter(
      (node) =>
        (!focusIds || focusIds.has(node.id)) &&
        (node.id === focusId || selectedTypes.length === 0 || selectedTypes.includes(node.type)),
    );
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    // Fresh link objects every time: d3 rewrites source/target to node references,
    // and a recycled link pointing at a filtered-out node crashes the link force.
    const visibleLinks = fullData.links
      .filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target))
      .map((l) => ({ source: l.source, target: l.target }));

    // Preserve node positions from previous render
    // This ref access during render is intentional to maintain node positions
    // when the graph data changes (e.g., when URN metadata updates)
    /* eslint-disable react/react-compiler -- carry force-simulation positions across rebuilds */
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

    for (let i = 0; i < visibleNodes.length; i++) {
      const node = visibleNodes[i];
      const existing = existingNodes.get(node.id);
      if (existing && typeof existing.x === "number" && typeof existing.y === "number") {
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
    /* eslint-enable react/react-compiler */

    return {
      nodes: visibleNodes as unknown as NodeObject[],
      links: visibleLinks as unknown as LinkObject[],
    };
  }, [fullData, focusIds, focusId, selectedTypes]);

  const hoverNeighbors = useMemo(
    () => (hoveredNode ? (fullAdjacency.get(hoveredNode.id) ?? null) : null),
    [hoveredNode, fullAdjacency],
  );

  const hoverLinkInfo = useMemo(() => {
    if (!hoveredNode) return null;
    const outgoing = linkDirections.outgoing.get(hoveredNode.id) ?? [];
    const incoming = linkDirections.incoming.get(hoveredNode.id) ?? [];
    return {
      outgoing: outgoing.length,
      incoming: incoming.length,
      referencedBy: incoming.slice(0, 4).map((id) => nodeLabelById.get(id) ?? "Untitled"),
      moreReferences: Math.max(0, incoming.length - 4),
    };
  }, [hoveredNode, linkDirections, nodeLabelById]);

  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!normalizedQuery) return null;
    const matches = new Set<string>();
    for (const node of graphData.nodes) {
      const graphNode = asGraphNode(node);
      if (graphNode.label.toLowerCase().includes(normalizedQuery)) matches.add(graphNode.id);
    }
    return matches;
  }, [graphData, normalizedQuery]);

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

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height });
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Simulation tuning: collision keeps nodes apart, the axis pull keeps
  // disconnected components from drifting off-screen.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || graphData.nodes.length === 0) return;

    const charge = fg.d3Force("charge") as
      | { strength: (v: number) => void; distanceMax: (v: number) => void }
      | undefined;
    charge?.strength(-150);
    charge?.distanceMax(450);

    const link = fg.d3Force("link") as
      | { distance: (fn: (l: LinkObject) => number) => void }
      | undefined;
    link?.distance((l: LinkObject) => {
      const sourceSize =
        typeof l.source === "object" ? getNodeSize(asGraphNode(l.source as NodeObject)) : 6;
      const targetSize =
        typeof l.target === "object" ? getNodeSize(asGraphNode(l.target as NodeObject)) : 6;
      return 28 + sourceSize + targetSize;
    });

    fg.d3Force(
      "collide",
      // Tiles are squares of side 1.8x the radius, so pad by their half-diagonal
      collisionForce((node) => getNodeSize(asGraphNode(node)) * 1.3 + 4),
    );
    fg.d3Force("x", axisPullForce("x", 0.04));
    fg.d3Force("y", axisPullForce("y", 0.04));
    fg.d3ReheatSimulation();
  }, [graphData, dimensions]);

  // Frame the whole graph instead of a fixed zoom at the origin: once when data
  // arrives, and again when the simulation settles into its final layout.
  const hasSettledRef = useRef(false);
  const frameGraph = useCallback(() => {
    const fg = graphRef.current;
    if (!fg) return;
    fg.zoomToFit(500, 90);
    // zoomToFit overshoots on tiny graphs; pull back to a sane magnification.
    window.setTimeout(() => {
      if ((graphRef.current?.zoom() ?? 0) > 4) graphRef.current?.zoom(4, 200);
    }, 550);
  }, []);

  useEffect(() => {
    if (hasSettledRef.current || !dimensions || graphData.nodes.length === 0) return;
    const timer = setTimeout(frameGraph, 400);
    return () => clearTimeout(timer);
  }, [graphData.nodes.length, dimensions, frameGraph]);

  const handleEngineStop = useCallback(() => {
    if (hasSettledRef.current) return;
    hasSettledRef.current = true;
    frameGraph();
  }, [frameGraph]);

  // Re-frame when the focus scope changes - the visible set can move anywhere
  const focusScope = focusId ? `${focusId}:${focusDepth}` : null;
  const lastFramedFocusRef = useRef(focusScope);
  useEffect(() => {
    if (lastFramedFocusRef.current === focusScope) return;
    lastFramedFocusRef.current = focusScope;
    if (graphData.nodes.length === 0) return;
    const timer = setTimeout(frameGraph, 450);
    return () => clearTimeout(timer);
  }, [focusScope, graphData.nodes.length, frameGraph]);

  // Cleanup: pause animation immediately on unmount to prevent navigation delays
  useEffect(() => {
    // Capture ref value inside effect to avoid stale reference in cleanup
    const graph = graphRef.current;
    return () => {
      graph?.pauseAnimation();
    };
  }, []);

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

  const handleNodeClick = useCallback(
    (node: NodeObject) => {
      const graphNode = asGraphNode(node);
      const path = urnToPath(graphNode.urn);
      if (path !== "#") {
        navigate(path);
      }
    },
    [navigate],
  );

  const findNodeAtPosition = useCallback((screenX: number, screenY: number): NodeObject | null => {
    if (!graphRef.current || !containerRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;

    const graphCoords = graphRef.current.screen2GraphCoords(x, y);
    if (!graphCoords) return null;

    return hitIndexRef.current.closest(graphCoords.x, graphCoords.y, GRAPH_HIT_RADIUS);
  }, []);

  const clearHitIndex = useCallback(() => hitIndexRef.current.clear(), []);

  // The compiler infers the stable `setHoveredNode` as the dependency; the real
  // one is `findNodeAtPosition`, and this closure has to stay stable because it
  // is registered as a native pointer listener on the graph canvas.
  /* eslint-disable react/react-compiler -- manual deps are the correct ones here */
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
            containerRef.current.style.cursor = "pointer";
          }
        } else {
          setHoveredNode(null);
          if (containerRef.current) {
            containerRef.current.style.cursor = "grab";
          }
        }
      }
    },
    [findNodeAtPosition],
  );
  /* eslint-enable react/react-compiler */

  // Click walks the graph (focus), double-click opens the content. The single
  // click is deferred so a double-click never fires a focus change first.
  const clickTimerRef = useRef<number | null>(null);
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      const node = findNodeAtPosition(e.clientX, e.clientY);
      if (!node) return;
      const nodeId = asGraphNode(node).id;
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (nodeId === focusId) {
          handleNodeClick(node);
        } else {
          setFocus(nodeId);
        }
      }, 250);
    },
    [findNodeAtPosition, focusId, handleNodeClick, setFocus],
  );

  const handleCanvasDblClick = useCallback(
    (e: MouseEvent) => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      const node = findNodeAtPosition(e.clientX, e.clientY);
      if (node) handleNodeClick(node);
    },
    [findNodeAtPosition, handleNodeClick],
  );

  useEffect(
    () => () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    },
    [],
  );

  // Attach custom mouse handlers to bypass library's broken hit detection
  useEffect(() => {
    if (!containerRef.current || loading) return;

    // Use MutationObserver to wait for canvas to be rendered
    let canvas = containerRef.current.querySelector("canvas");

    const attachHandlers = (canvasEl: HTMLCanvasElement) => {
      canvasEl.addEventListener("mousemove", handleCanvasMouseMove);
      canvasEl.addEventListener("click", handleCanvasClick);
      canvasEl.addEventListener("dblclick", handleCanvasDblClick);
    };

    const detachHandlers = (canvasEl: HTMLCanvasElement) => {
      canvasEl.removeEventListener("mousemove", handleCanvasMouseMove);
      canvasEl.removeEventListener("click", handleCanvasClick);
      canvasEl.removeEventListener("dblclick", handleCanvasDblClick);
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
  }, [handleCanvasMouseMove, handleCanvasClick, handleCanvasDblClick, loading]);

  const paintNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      hitIndexRef.current.add(node);
      const graphNode = asGraphNode(node);
      const size = getNodeSize(graphNode);
      const isHovered = hoveredNode?.id === graphNode.id;
      const isNeighbor = hoverNeighbors?.has(graphNode.id) ?? false;
      const isFocusRoot = graphNode.id === focusId;
      const matchesSearch = searchMatches?.has(graphNode.id) ?? false;
      // Hover focus wins, then search: everything outside the active set recedes.
      const dimmed = hoveredNode
        ? !isHovered && !isNeighbor
        : searchMatches
          ? !matchesSearch
          : false;
      const isPerson = PERSON_TYPES.has(graphNode.type);
      // Type picks a slice of the Unity Violet -> Belonging Pink axis, so the canvas
      // reads as one sweep and hue tells you the type; shape and icon separate them
      // further. People are told apart by their initials, not by their fill.
      const stops = getUrnTypeBrandStops(graphNode.type);
      const nodeColor = stops.start;
      const x = node.x || 0;
      const y = node.y || 0;

      const targetAlpha = dimmed ? 0.14 : 1;
      const alphaMap = dimAlphaRef.current;
      const current = alphaMap.get(graphNode.id) ?? 1;
      let alpha = current + (targetAlpha - current) * 0.25;
      if (Math.abs(alpha - targetAlpha) < 0.01) alpha = targetAlpha;
      alphaMap.set(graphNode.id, alpha);

      ctx.save();
      ctx.globalAlpha = alpha;

      // Outer glow for hovered nodes
      if (isHovered) {
        const gradient = ctx.createRadialGradient(x, y, size, x, y, size * 3);
        gradient.addColorStop(0, nodeColor + "40");
        gradient.addColorStop(1, nodeColor + "00");
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Node shadow
      ctx.shadowColor = nodeColor + "60";
      ctx.shadowBlur = isHovered ? 20 : 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      const fill = ctx.createLinearGradient(x - size, y - size, x + size, y + size);
      fill.addColorStop(0, stops.start);
      fill.addColorStop(1, stops.end);

      traceNodeShape(ctx, graphNode, x, y);
      ctx.fillStyle = fill;
      ctx.fill();

      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      if (isPerson) {
        // Avatar-style initials, matching SubjectAvatar everywhere else
        ctx.font = `600 ${Math.max(size * 0.85, 3)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.fillText(getInitials(graphNode.label), x, y + size * 0.05);
      } else {
        const icon = getIconImage(graphNode.type, "#ffffff", handleIconReady);
        if (icon.complete && icon.naturalWidth > 0) {
          const iconSize = isCircleNode(graphNode.type) ? size * 1.15 : size * 1.05;
          ctx.drawImage(icon, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
        }
      }

      // Border ring (consistent for all nodes)
      traceNodeShape(ctx, graphNode, x, y);
      ctx.strokeStyle = isHovered ? themeColors.foreground : nodeColor;
      ctx.lineWidth = isHovered ? 2 / globalScale : 1 / globalScale;
      ctx.stroke();

      // Focus root gets a standing accent halo so the anchor stays identifiable
      if (isFocusRoot) {
        traceNodeShape(ctx, graphNode, x, y, 3.5 / globalScale);
        ctx.strokeStyle = themeColors.primary;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Zoom-scaled label culling: at low zoom only hubs get labels, hover
      // always shows its own neighborhood, search always labels its matches.
      // Prevents the label soup dense clusters produce when every node draws text.
      const showLabel = hoveredNode
        ? isHovered || (isNeighbor && globalScale > 0.5)
        : searchMatches
          ? matchesSearch
          : isFocusRoot ||
            globalScale > 2.2 ||
            (globalScale > 1.2 && graphNode.connections >= 2) ||
            (globalScale > 0.7 && graphNode.connections >= 5);

      if (showLabel) {
        const fontSize = Math.max(11 / globalScale, 3);
        const label = graphNode.label;
        const maxLength = isHovered ? 34 : 20;
        const truncatedLabel = label.length > maxLength ? label.slice(0, maxLength) + "…" : label;

        ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
        const labelY = y + size + 5 / globalScale;
        const textWidth = measureLabel(ctx, truncatedLabel, fontSize);
        const padX = 4 / globalScale;
        const padY = 2.5 / globalScale;

        // Backdrop pill keeps labels legible where they cross links or nodes.
        ctx.beginPath();
        ctx.roundRect(
          x - textWidth / 2 - padX,
          labelY - padY,
          textWidth + padX * 2,
          fontSize + padY * 2,
          4 / globalScale,
        );
        ctx.fillStyle = themeColors.background + (isDark ? "cc" : "d9");
        ctx.fill();

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle =
          isHovered || isNeighbor || isFocusRoot || matchesSearch || graphNode.connections >= 5
            ? themeColors.foreground
            : themeColors.mutedForeground;
        ctx.fillText(truncatedLabel, x, labelY);
      }

      ctx.restore();
    },
    [hoveredNode, hoverNeighbors, focusId, searchMatches, themeColors, isDark, handleIconReady],
  );

  const isHoverAdjacentLink = useCallback(
    (link: LinkObject) => {
      if (!hoveredNode) return false;
      const [sourceId, targetId] = linkEndpointIds(link);
      return hoveredNode.id === sourceId || hoveredNode.id === targetId;
    },
    [hoveredNode],
  );

  // Link styling
  const getLinkColor = useCallback(
    (link: LinkObject) => {
      if (hoveredNode) {
        if (isHoverAdjacentLink(link)) return GRAPH_LINK_PAINT.active;
        return isDark ? GRAPH_LINK_PAINT.dimmedDark : GRAPH_LINK_PAINT.dimmedLight;
      }
      return isDark ? GRAPH_LINK_PAINT.idleDark : GRAPH_LINK_PAINT.idleLight;
    },
    [hoveredNode, isHoverAdjacentLink, isDark],
  );

  const getLinkWidth = useCallback(
    (link: LinkObject) => (isHoverAdjacentLink(link) ? 2 : 1),
    [isHoverAdjacentLink],
  );

  // Arrows read direction at a glance, so they get more contrast than the line
  const getLinkArrowColor = useCallback(
    (link: LinkObject) => {
      if (hoveredNode) {
        if (isHoverAdjacentLink(link)) return GRAPH_ARROW_PAINT.active;
        return isDark ? GRAPH_ARROW_PAINT.dimmedDark : GRAPH_ARROW_PAINT.dimmedLight;
      }
      return isDark ? GRAPH_ARROW_PAINT.idleDark : GRAPH_ARROW_PAINT.idleLight;
    },
    [hoveredNode, isHoverAdjacentLink, isDark],
  );

  // Particles only animate on the hovered neighborhood - a constant particle
  // swarm across every link reads as noise and burns CPU on big graphs.
  const getLinkParticles = useCallback(
    (link: LinkObject) => (isHoverAdjacentLink(link) ? 2 : 0),
    [isHoverAdjacentLink],
  );

  // Empty state (no accessible mention edges at all; filtered-empty still renders the canvas)
  if ((graphStatus === "succeeded" || graphStatus === "failed") && fullData.nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-background to-muted/30">
        <div className="text-center p-8 max-w-md">
          <div className="relative mx-auto w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
            <div className="relative w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 rounded-full flex items-center justify-center border border-primary/20">
              <Cube size={48} weight="duotone" className="text-primary/60" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-3">Knowledge Graph</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            {graphStatus === "failed"
              ? (graphError ?? "The graph could not be loaded.")
              : "Link notes, tasks, and events together with @mentions to map how your organization's knowledge connects."}
          </p>
          {graphStatus === "failed" && (
            <button
              type="button"
              onClick={() => organizationId && dispatch(fetchContentGraph(organizationId))}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* Graph container */}
      <div ref={containerRef} className="flex-1 relative min-h-0 w-full">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-72 [background-image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
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
            // Arrow tips offset from the target by the library's own radius
            // (nodeRelSize * sqrt(val)); match it to the painted node size so
            // arrowheads land at the tile edge instead of underneath it.
            nodeVal={(node: NodeObject) => {
              const size = getNodeSize(asGraphNode(node)) * 1.15;
              return (size * size) / 16;
            }}
            nodeCanvasObject={paintNode}
            nodeCanvasObjectMode={() => "replace"}
            onRenderFramePre={clearHitIndex}
            linkColor={getLinkColor}
            linkWidth={getLinkWidth}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={getLinkArrowColor}
            linkDirectionalParticles={getLinkParticles}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.005}
            linkDirectionalParticleColor={() => GRAPH_ARROW_PAINT.active}
            onEngineStop={handleEngineStop}
            // Pointer events use the frame-refreshed position index above.
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
          <div className="absolute top-4 right-4 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl p-4 max-w-xs animate-in fade-in slide-in-from-right-2 duration-200 pointer-events-none">
            <div className="flex items-start gap-3">
              {PERSON_TYPES.has(hoveredNode.type) ? (
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-inner"
                  style={{
                    // Matches the node on the canvas, which rides the type's slice of
                    // the brand axis rather than the per-person avatar hash.
                    background: brandGradient(getUrnTypeBrandStops(hoveredNode.type)),
                  }}
                >
                  {getInitials(hoveredNode.label)}
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-10 w-10 flex-shrink-0 items-center justify-center shadow-inner",
                    hoveredNode.type === UrnType.AGENT ? "rounded-full" : "rounded-lg",
                  )}
                  style={{
                    background: `linear-gradient(135deg, ${hoveredNode.color}20, ${hoveredNode.color}10)`,
                    borderColor: hoveredNode.color + "30",
                    borderWidth: 1,
                  }}
                >
                  {(() => {
                    const Icon = getContentTypeIcon(hoveredNode.type);
                    return <Icon size={20} weight="duotone" style={{ color: hoveredNode.color }} />;
                  })()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate">{hoveredNode.label}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-md"
                    style={{
                      backgroundColor: hoveredNode.color + "15",
                      color: hoveredNode.color,
                    }}
                  >
                    {getContentTypeLabel(hoveredNode.type)}
                  </span>
                </div>
                {hoverLinkInfo && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {hoverLinkInfo.outgoing} outgoing · {hoverLinkInfo.incoming} incoming
                  </p>
                )}
              </div>
            </div>
            <GraphNodeDetails node={hoveredNode} meta={urnMetadata.get(hoveredNode.urn)} />
            {hoverLinkInfo && hoverLinkInfo.referencedBy.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Referenced by
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {hoverLinkInfo.referencedBy.map((label, i) => (
                    <li key={i} className="truncate text-xs text-foreground">
                      {label}
                    </li>
                  ))}
                </ul>
                {hoverLinkInfo.moreReferences > 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    +{hoverLinkInfo.moreReferences} more
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-1.5 text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Click</kbd>
              <span>{hoveredNode.id === focusId ? "to open" : "to focus"}</span>
              {hoveredNode.id !== focusId &&
                (hoveredNode.isInternal ||
                  (hoveredNode.urn && urnToPath(hoveredNode.urn) !== "#")) && (
                  <>
                    <span aria-hidden="true">·</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                      2×Click
                    </kbd>
                    <span>to open</span>
                  </>
                )}
            </div>
          </div>
        )}

        {/* Node search and the focus scope chip */}
        <div className="absolute left-4 top-4 z-10 flex flex-col items-start gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && searchMatches && searchMatches.size > 0) {
                  graphRef.current?.zoomToFit(500, 120, (n) =>
                    searchMatches.has(asGraphNode(n).id),
                  );
                }
              }}
              placeholder="Filter graph..."
              className={cn(
                "w-56 rounded-full border border-border bg-card py-2 pl-9 pr-8 text-xs text-foreground",
                "shadow-md placeholder:text-muted-foreground",
                "transition-[width,border-color] duration-200 focus:w-72 focus:border-primary/60 focus:outline-none",
              )}
              data-testid="graph-search"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </div>

          {focusId && (
            <div
              className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary shadow-lg backdrop-blur-sm"
              data-testid="graph-focus-chip"
            >
              <span className="max-w-52 truncate">{nodeLabelById.get(focusId) ?? "Focused"}</span>
              <button
                type="button"
                onClick={cycleFocusDepth}
                className="rounded-full bg-primary/15 px-1.5 py-0.5 font-medium tabular-nums hover:bg-primary/25"
                title="Change focus depth"
                data-testid="graph-focus-depth"
              >
                {focusDepth} hop{focusDepth === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => setFocus(null)}
                aria-label="Show full graph"
                className="hover:text-foreground"
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          )}

          {graphTruncated && (
            <div
              role="status"
              className="flex max-w-72 items-center gap-2 rounded-lg border border-yellow-300/60 bg-yellow-100/90 px-3 py-2 text-xs text-yellow-900 shadow-lg backdrop-blur-sm dark:border-yellow-700/60 dark:bg-yellow-950/80 dark:text-yellow-200"
              data-testid="graph-truncation-notice"
            >
              <WarningCircle size={16} weight="fill" className="shrink-0" />
              <span>Showing a bounded view of this large graph.</span>
            </div>
          )}

          {focusMissing && (
            <div
              role="status"
              className="flex max-w-72 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur-sm"
              data-testid="graph-focus-missing-notice"
            >
              <WarningCircle size={16} className="shrink-0" />
              <span>
                That item is not in this view of the graph
                {graphTruncated ? ", which is bounded to recently updated content." : "."}
              </span>
            </div>
          )}

          {searchMatches && (
            <span className="text-xs text-muted-foreground">
              {searchMatches.size} match{searchMatches.size === 1 ? "" : "es"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
