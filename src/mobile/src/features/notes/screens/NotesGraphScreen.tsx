import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import Svg, { G, Circle, Line, Polygon, Text as SvgText } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  ArrowsOut,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  NotePencil,
  X,
} from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useNotesGraph } from "@features/notes/useNotesGraph";
import type { SimNode } from "@features/notes/useNotesGraph";

const AnimatedG = Animated.createAnimatedComponent(G);

const NODE_HIT_RADIUS = 28;
const NODE_BASE_RADIUS = 8;
const NODE_MAX_BONUS = 8;
const MAX_TICKS = 130;
const TICKS_PER_FRAME = 3;

const ARROW_SIZE = 3.5; // half-width of arrowhead triangle
const ARROW_MAX = 4; // arrowheads drawn along one highlighted edge
const ARROW_MIN_GAP = 90; // px of edge each arrowhead wants to itself

const REPULSION = 2800;
const SPRING_LENGTH = 110;
const SPRING_K = 0.1;
const CENTER_K = 0.022;
const DAMPING = 0.76;

// Arrowheads pointing away from the selected node, at rest. They used to crawl
// along the edge, which meant re-rendering and re-rasterising the whole drawing
// on every frame for as long as anything was selected - some 700ms a frame with
// the couple of hundred arrowheads a well-connected node produced. Direction is
// what the arrows are actually for, and standing still they say it just as well.
function directionArrows(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
): React.ReactElement[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 12) return [];

  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const count = Math.max(1, Math.min(ARROW_MAX, Math.floor(len / ARROW_MIN_GAP)));
  const result: React.ReactElement[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    result.push(
      <G key={i} transform={`translate(${x1 + dx * t},${y1 + dy * t}) rotate(${angleDeg})`}>
        <Polygon
          points={`${ARROW_SIZE * 1.4},0 ${-ARROW_SIZE * 0.7},${ARROW_SIZE * 0.8} ${-ARROW_SIZE * 0.7},${-ARROW_SIZE * 0.8}`}
          fill={color}
          fillOpacity={0.55}
        />
      </G>,
    );
  }
  return result;
}

function getNodeRadius(connections: number): number {
  return NODE_BASE_RADIUS + Math.min(connections * 1.2, NODE_MAX_BONUS);
}

function simulationTick(nodes: SimNode[], linkPairs: { si: number; ti: number }[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 0.001) continue;
      const d = Math.sqrt(d2);
      const f = REPULSION / d2;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      nodes[i].vx += fx;
      nodes[i].vy += fy;
      nodes[j].vx -= fx;
      nodes[j].vy -= fy;
    }
  }

  for (const { si, ti } of linkPairs) {
    const dx = nodes[ti].x - nodes[si].x;
    const dy = nodes[ti].y - nodes[si].y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
    const f = SPRING_K * (d - SPRING_LENGTH);
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    nodes[si].vx += fx;
    nodes[si].vy += fy;
    nodes[ti].vx -= fx;
    nodes[ti].vy -= fy;
  }

  for (let i = 0; i < nodes.length; i++) {
    nodes[i].vx -= nodes[i].x * CENTER_K;
    nodes[i].vy -= nodes[i].y * CENTER_K;
    nodes[i].vx *= DAMPING;
    nodes[i].vy *= DAMPING;
    nodes[i].x += nodes[i].vx;
    nodes[i].y += nodes[i].vy;
  }
}

export function NotesGraphScreen() {
  const T = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The screen hides the app's floating bar (see `immersive` in the root
  // layout), so its own controls are what has to clear the system nav bar.
  const controlsBottom = insets.bottom + 16;
  const graph = useNotesGraph();

  // Live simulation state
  const nodesRef = useRef<SimNode[]>([]);
  const linkPairsRef = useRef<{ si: number; ti: number }[]>([]);
  const tickCountRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // The physics loop mutates node objects in place inside refs. Render must not
  // read those refs, so each frame publishes an immutable snapshot of what the
  // SVG draws; that snapshot is also what triggers the re-render.
  const [frame, setFrame] = useState<{ nodes: SimNode[] }>({ nodes: [] });

  // Pan and zoom live on the UI thread. Held in React state they re-rendered
  // every node and edge on every finger movement, which is what made dragging
  // the graph crawl; as shared values the gesture only rewrites one transform
  // and never enters JS. The tap handler still reads them - a shared value is
  // readable from either side.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(2);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  // The live gesture, held apart from the committed transform above. It moves
  // the view that holds the drawing rather than the drawing itself, which is
  // the whole point: react-native-svg caches its canvas as a bitmap and only
  // re-rasterises when a child invalidates, so sliding the parent view costs a
  // composite and nothing else. The gesture folds into the committed transform
  // when the finger lifts - one redraw per gesture instead of one per frame.
  const dX = useSharedValue(0);
  const dY = useSharedValue(0);
  const dS = useSharedValue(1);

  // The drawing stays where it is and the group inside it moves. A view
  // transform would be cheaper - it composites instead of redrawing - but
  // react-native-svg rasterises the whole SvgView into a bitmap of its own
  // size, so a canvas big enough to pan across is a bitmap big enough to
  // exhaust the heap. Animated props at least keep the gesture off the JS
  // thread: only this transform is rewritten, no React render runs.
  const rootProps = useAnimatedProps(() => ({
    transform: `translate(${width / 2 + translateX.value}, ${(height - 60) / 2 + translateY.value}) scale(${scale.value})`,
  }));

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dX.value }, { translateY: dY.value }, { scale: dS.value }],
  }));

  // Committed on the UI thread, so the drawing's new transform and the view's
  // reset to neutral are applied in the same frame. Split across threads they
  // would land a frame apart and the graph would jump.
  const commitGesture = () => {
    "worklet";
    translateX.value = translateX.value * dS.value + dX.value;
    translateY.value = translateY.value * dS.value + dY.value;
    scale.value = scale.value * dS.value;
    dX.value = 0;
    dY.value = 0;
    dS.value = 1;
  };

  // Graph fade-in animation
  const graphOpacity = useSharedValue(0);
  const graphAnimStyle = useAnimatedStyle(() => ({ opacity: graphOpacity.value }));

  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);

  // Every published frame re-renders the whole drawing - several elements per
  // node, one per edge - and react-native-svg re-rasterises its canvas whenever
  // a child changes. That is worth paying while the layout is settling and not
  // one frame longer, so the loop stops dead when the positions come to rest.
  const animateRef = useRef<() => void>(() => {});
  animateRef.current = () => {
    for (let t = 0; t < TICKS_PER_FRAME && tickCountRef.current < MAX_TICKS; t++) {
      simulationTick(nodesRef.current, linkPairsRef.current);
      tickCountRef.current++;
    }
    const settling = tickCountRef.current < MAX_TICKS;

    // Cloned only while the positions are still moving; once settled the same
    // array is handed back, so the last frame allocates nothing.
    setFrame({ nodes: settling ? nodesRef.current.map((n) => ({ ...n })) : nodesRef.current });

    rafRef.current = settling ? requestAnimationFrame(animateRef.current) : null;
  };

  // Combined simulation + edge animation loop — runs continuously
  useEffect(() => {
    if (!graph.data) return;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const nodes: SimNode[] = graph.data.nodes.map((n) => ({ ...n, vx: 0, vy: 0 }));
    const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const linkPairs = graph.data.links
      .map((l) => ({ si: idToIdx.get(l.source)!, ti: idToIdx.get(l.target)! }))
      .filter((l) => l.si !== undefined && l.ti !== undefined && l.si !== l.ti);

    nodesRef.current = nodes;
    linkPairsRef.current = linkPairs;
    tickCountRef.current = 0;

    graphOpacity.value = 0;
    graphOpacity.value = withTiming(1, { duration: 500 });

    rafRef.current = requestAnimationFrame(animateRef.current);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [graph.data, graphOpacity]);

  const pan = Gesture.Pan()
    .minDistance(2)
    .onBegin(() => {
      startTranslateX.value = dX.value;
      startTranslateY.value = dY.value;
    })
    .onUpdate((e) => {
      dX.value = startTranslateX.value + e.translationX;
      dY.value = startTranslateY.value + e.translationY;
    })
    .onEnd(commitGesture);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = dS.value;
    })
    .onUpdate((e) => {
      // Clamped on the composite, not on the gesture's own factor, so the limit
      // means the same thing whatever zoom the gesture started from.
      const target = scale.value * startScale.value * e.scale;
      const clamped = Math.max(0.15, Math.min(5, target));
      dS.value = clamped / scale.value;
    })
    .onEnd(commitGesture);

  const tap = Gesture.Tap()
    .maxDuration(250)
    .maxDistance(10)
    .onEnd((e) => {
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;
      // Composite of what is drawn and what the view is still holding, so a tap
      // hits the node under the finger even mid-gesture.
      const s = scale.value * dS.value;
      const cx = width / 2 + translateX.value * dS.value + dX.value;
      const cy = (height - 60) / 2 + translateY.value * dS.value + dY.value;
      const gx = (e.x - cx) / s;
      const gy = (e.y - cy) / s;

      let closest: SimNode | null = null;
      let closestDist = NODE_HIT_RADIUS;
      for (const node of nodes) {
        const dx = gx - node.x;
        const dy = gy - node.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < closestDist) {
          closestDist = d;
          closest = node;
        }
      }
      setSelectedNode(closest ?? null);
    })
    .runOnJS(true);

  const composed = Gesture.Simultaneous(Gesture.Race(tap, pan), pinch);

  const handleFitAll = useCallback(() => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;
    const padding = 60;
    const canvasW = width - padding * 2;
    const canvasH = height - 60 - padding * 2;
    const newScale = Math.min(canvasW / graphW, canvasH / graphH, 3);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    scale.value = newScale;
    translateX.value = -centerX * newScale;
    translateY.value = -centerY * newScale;
  }, [width, height, scale, translateX, translateY]);

  const handleZoom = useCallback(
    (factor: number) => {
      scale.value = Math.max(0.15, Math.min(5, scale.value * factor));
    },
    [scale],
  );

  const nodes = frame.nodes;
  const links = useMemo(() => graph.data?.links ?? [], [graph.data]);
  const nodePosMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Build the "neighbourhood" of the selected node — used to dim everything else
  // Rebuilt only when the selection or the link set changes - it used to be
  // recomputed on every published frame, which meant walking every link 60
  // times a second while a node was selected.
  const focusedIds = useMemo<Set<string> | null>(() => {
    if (!selectedNode) return null;
    const ids = new Set<string>([selectedNode.id]);
    for (const l of links) {
      if (l.source === selectedNode.id) ids.add(l.target);
      if (l.target === selectedNode.id) ids.add(l.source);
    }
    return ids;
  }, [selectedNode, links]);

  const stats = graph.data
    ? `${graph.data.nodes.length} notes · ${links.filter((l) => l.source !== l.target).length} links`
    : "";

  const edgeDimColor = T.isDark ? "rgba(140,120,200,0.22)" : "rgba(100,80,160,0.18)";

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Knowledge Graph"
        color={T.accent}
        icon="notes"
        onBack={() => router.back()}
      />

      {graph.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : graph.data && graph.data.nodes.length === 0 ? (
        <EmptyGraph T={T} />
      ) : (
        <Animated.View style={[styles.canvas, graphAnimStyle]}>
          <GestureDetector gesture={composed}>
            <View style={StyleSheet.absoluteFill}>
              {/* Screen-sized on purpose: the canvas size IS the bitmap size,
                  and a canvas big enough to pan across is a bitmap big enough
                  to exhaust the heap. Panning past its edge shows empty space
                  until the finger lifts and the drawing is re-issued. */}
              <Animated.View style={[StyleSheet.absoluteFill, surfaceStyle]}>
                <Svg width={width} height={height - 60}>
                  <AnimatedG animatedProps={rootProps}>
                    {/* Edges — rendered in two passes so glows are under all main lines */}
                    {links
                      .filter((l) => l.source !== l.target)
                      .map((l, i) => {
                        const s = nodePosMap.get(l.source);
                        const t = nodePosMap.get(l.target);
                        if (!s || !t) return null;

                        const isHighlighted =
                          !!selectedNode &&
                          (selectedNode.id === l.source || selectedNode.id === l.target);

                        if (!isHighlighted) {
                          const isDimmed = !!focusedIds;
                          return (
                            <Line
                              key={i}
                              x1={s.x}
                              y1={s.y}
                              x2={t.x}
                              y2={t.y}
                              stroke={edgeDimColor}
                              strokeWidth={1}
                              strokeOpacity={isDimmed ? 0.25 : 1}
                            />
                          );
                        }

                        // Selected edge: glow + flowing directional arrows
                        // Arrows always flow outward FROM the selected node
                        const isOutgoing = selectedNode.id === l.source;
                        const [ax1, ay1, ax2, ay2] = isOutgoing
                          ? [s.x, s.y, t.x, t.y]
                          : [t.x, t.y, s.x, s.y];
                        return (
                          <G key={i}>
                            {/* Outer soft glow */}
                            <Line
                              x1={s.x}
                              y1={s.y}
                              x2={t.x}
                              y2={t.y}
                              stroke={T.accent}
                              strokeWidth={8}
                              strokeOpacity={0.12}
                              strokeLinecap="round"
                            />
                            {/* Base line */}
                            <Line
                              x1={s.x}
                              y1={s.y}
                              x2={t.x}
                              y2={t.y}
                              stroke={T.accent}
                              strokeWidth={2}
                              strokeOpacity={0.5}
                              strokeLinecap="round"
                            />
                            {directionArrows(ax1, ay1, ax2, ay2, T.accent)}
                          </G>
                        );
                      })}

                    {/* A still halo, not the ring that used to pulse here. An
                        animated prop on an SVG child invalidates the canvas
                        bitmap on every frame of it, so one decorative ring was
                        re-rasterising the entire graph sixty times a second for
                        as long as anything was selected. */}
                    {selectedNode && (
                      <Circle
                        cx={selectedNode.x}
                        cy={selectedNode.y}
                        r={getNodeRadius(selectedNode.connections) + 14}
                        fill={selectedNode.color}
                        fillOpacity={0.18}
                      />
                    )}

                    {/* Nodes */}
                    {nodes.map((node) => {
                      const r = getNodeRadius(node.connections);
                      const isSelected = selectedNode?.id === node.id;
                      const isDimmed = focusedIds !== null && !focusedIds.has(node.id);
                      const dimOpacity = isDimmed ? 0.15 : 1;
                      return (
                        // Dimming is folded into each element's own opacity
                        // rather than set on the group: a group opacity below 1
                        // makes Android render that group through an offscreen
                        // layer, and with one group per node a selection turned
                        // every redraw into sixty layer allocations.
                        <G key={node.id}>
                          {/* Layered glow rings */}
                          {/* One halo, where three stacked rings and a
                              specular dot used to be. Each is redrawn for every
                              node on every redraw, and the two faintest of them
                              were invisible against the one that reads. */}
                          <Circle
                            cx={node.x}
                            cy={node.y}
                            r={r * 2}
                            fill={node.color}
                            fillOpacity={0.1 * dimOpacity}
                          />
                          <Circle
                            cx={node.x}
                            cy={node.y}
                            r={r}
                            fill={node.color}
                            fillOpacity={dimOpacity}
                            stroke={isSelected ? "#fff" : node.color}
                            strokeWidth={isSelected ? 2 : 0}
                          />
                          <SvgText
                            x={node.x}
                            y={node.y + r + 10}
                            textAnchor="middle"
                            fontSize={9}
                            fontFamily={FONT.regular}
                            fill={T.isDark ? "rgba(255,255,255,0.75)" : "rgba(30,30,40,0.8)"}
                            fillOpacity={dimOpacity}
                          >
                            {node.label.length > 16
                              ? node.label.slice(0, 14) + "\u2026"
                              : node.label}
                          </SvgText>
                        </G>
                      );
                    })}
                  </AnimatedG>
                </Svg>
              </Animated.View>
            </View>
          </GestureDetector>

          {/* Stats bar */}
          <View style={styles.statsBar} pointerEvents="none">
            <Text style={[styles.statsText, { color: T.textDim }]}>{stats}</Text>
          </View>

          {/* Zoom controls */}
          <View style={[styles.zoomControls, { bottom: controlsBottom }]}>
            <TouchableOpacity
              style={[styles.zoomBtn, { backgroundColor: T.surface, borderColor: T.border }]}
              onPress={() => handleZoom(1.4)}
              activeOpacity={0.7}
            >
              <MagnifyingGlassPlus size={18} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomBtn, { backgroundColor: T.surface, borderColor: T.border }]}
              onPress={() => handleZoom(0.7)}
              activeOpacity={0.7}
            >
              <MagnifyingGlassMinus size={18} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomBtn, { backgroundColor: T.surface, borderColor: T.border }]}
              onPress={handleFitAll}
              activeOpacity={0.7}
            >
              <ArrowsOut size={18} color={T.text} weight="duotone" />
            </TouchableOpacity>
          </View>

          {/* Selected node card */}
          {selectedNode && (
            <View
              style={[
                styles.nodeCard,
                { backgroundColor: T.surface, borderColor: T.border, bottom: controlsBottom },
              ]}
            >
              <View style={styles.nodeCardHeader}>
                <View style={[styles.nodeCardIcon, { backgroundColor: selectedNode.color + "20" }]}>
                  <NotePencil size={18} color={selectedNode.color} weight="fill" />
                </View>
                <View style={styles.nodeCardBody}>
                  <Text style={[styles.nodeCardTitle, { color: T.textBright }]} numberOfLines={2}>
                    {selectedNode.label}
                  </Text>
                  <Text style={[styles.nodeCardMeta, { color: T.textDim }]}>
                    {selectedNode.connections} connection{selectedNode.connections !== 1 ? "s" : ""}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedNode(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={16} color={T.textDim} weight="duotone" />
                </TouchableOpacity>
              </View>
              {
                <TouchableOpacity
                  style={[styles.nodeCardBtn, { backgroundColor: T.accent }]}
                  onPress={() => {
                    setSelectedNode(null);
                    router.push(`/notes/${selectedNode.id}` as any);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.nodeCardBtnText}>Open note</Text>
                </TouchableOpacity>
              }
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function EmptyGraph({ T }: { T: ThemeColors & { isDark: boolean } }) {
  return (
    <View style={styles.center}>
      <View style={[styles.emptyIcon, { backgroundColor: T.accentSoft }]}>
        <NotePencil size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No graph yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Link notes together using @mentions to build your knowledge graph.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  canvas: { flex: 1, overflow: "hidden" },
  surface: { position: "absolute" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: FONT.regular,
    textAlign: "center",
    lineHeight: 20,
  },
  statsBar: {
    position: "absolute",
    top: 12,
    left: 16,
  },
  statsText: { fontSize: 11, fontFamily: FONT.regular },
  zoomControls: {
    position: "absolute",
    bottom: 24,
    right: 16,
    gap: 8,
  },
  zoomBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  nodeCard: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 72,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  nodeCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  nodeCardIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  nodeCardBody: { flex: 1, gap: 2 },
  nodeCardTitle: { fontSize: 14, fontFamily: FONT.semibold },
  nodeCardMeta: { fontSize: 12, fontFamily: FONT.regular },
  nodeCardBtn: {
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  nodeCardBtnText: { fontSize: 13, fontFamily: FONT.semibold, color: "#fff" },
});
