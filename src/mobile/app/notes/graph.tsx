import React, { useRef, useState, useCallback, useEffect } from "react";
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
  withRepeat,
  cancelAnimation,
  interpolate,
  Easing,
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
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { DOMAIN_COLORS } from "@/constants/theme";
import { useNotesGraph } from "@/hooks/useNotesGraph";
import type { SimNode } from "@/hooks/useNotesGraph";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const NODE_HIT_RADIUS = 28;
const NODE_BASE_RADIUS = 8;
const NODE_MAX_BONUS = 8;
const MAX_TICKS = 130;
const TICKS_PER_FRAME = 3;

const ARROW_SPACING = 36; // px between arrow heads
const ARROW_SIZE = 3.5; // half-width of arrowhead triangle
const EDGE_SPEED_SELECTED = 20; // px/s

const REPULSION = 2800;
const SPRING_LENGTH = 110;
const SPRING_K = 0.1;
const CENTER_K = 0.022;
const DAMPING = 0.76;

function flowingArrows(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  phase: number,
  color: string,
): React.ReactElement[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 12) return [];

  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const result: React.ReactElement[] = [];

  // Offset starting position by phase so arrows flow continuously
  let dist = phase % ARROW_SPACING;
  while (dist < len) {
    const t = dist / len;
    const ax = x1 + dx * t;
    const ay = y1 + dy * t;
    // Fade near both endpoints so arrows don't pop in/out abruptly
    const fade = Math.min(dist / 20, (len - dist) / 20, 1);
    result.push(
      <G key={dist} transform={`translate(${ax},${ay}) rotate(${angleDeg})`}>
        <Polygon
          points={`${ARROW_SIZE * 1.4},0 ${-ARROW_SIZE * 0.7},${ARROW_SIZE * 0.8} ${-ARROW_SIZE * 0.7},${-ARROW_SIZE * 0.8}`}
          fill={color}
          fillOpacity={0.55 * fade}
        />
      </G>,
    );
    dist += ARROW_SPACING;
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

export default function NotesGraphScreen() {
  const T = useTheme();
  const { width, height } = useWindowDimensions();
  const graph = useNotesGraph();

  // Live simulation state
  const nodesRef = useRef<SimNode[]>([]);
  const linkPairsRef = useRef<{ si: number; ti: number }[]>([]);
  const tickCountRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Edge animation phase ref — advanced each frame for selected edges
  const edgePhaseSelectedRef = useRef(0);

  const [tick, setTick] = useState(0);

  // Pan/zoom state via refs to avoid re-renders during gesture
  const translateX = useRef(0);
  const translateY = useRef(0);
  const scale = useRef(2);
  const startTranslateX = useRef(0);
  const startTranslateY = useRef(0);
  const startScale = useRef(1);
  const [transform, setTransform] = useState({ x: 0, y: 0, s: 2 });

  const commitTransform = useCallback(() => {
    setTransform({ x: translateX.current, y: translateY.current, s: scale.current });
  }, []);

  // Graph fade-in animation
  const graphOpacity = useSharedValue(0);
  const graphAnimStyle = useAnimatedStyle(() => ({ opacity: graphOpacity.value }));

  // Pulse ring for selected node
  const pulseAnim = useSharedValue(0);
  const pulseR = useSharedValue(NODE_BASE_RADIUS);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);

  useEffect(() => {
    if (selectedNode) {
      pulseR.value = getNodeRadius(selectedNode.connections);
      pulseAnim.value = 0;
      pulseAnim.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseAnim);
      pulseAnim.value = 0;
    }
  }, [selectedNode, pulseAnim, pulseR]);

  const pulseProps = useAnimatedProps(() => ({
    r: pulseR.value + interpolate(pulseAnim.value, [0, 1], [4, 24]),
    fillOpacity: interpolate(pulseAnim.value, [0, 1], [0.3, 0]),
  }));

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
    lastTimeRef.current = null;
    edgePhaseSelectedRef.current = 0;

    graphOpacity.value = 0;
    graphOpacity.value = withTiming(1, { duration: 500 });

    const animate = () => {
      // Advance simulation for the first MAX_TICKS frames
      for (let t = 0; t < TICKS_PER_FRAME && tickCountRef.current < MAX_TICKS; t++) {
        simulationTick(nodesRef.current, linkPairsRef.current);
        tickCountRef.current++;
      }

      // Advance edge animation phases using wall-clock time
      const now = Date.now();
      if (lastTimeRef.current !== null) {
        const dt = (now - lastTimeRef.current) / 1000; // seconds
        edgePhaseSelectedRef.current =
          (edgePhaseSelectedRef.current + dt * EDGE_SPEED_SELECTED) % ARROW_SPACING;
      }
      lastTimeRef.current = now;

      setTick((v) => v + 1);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

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
      startTranslateX.current = translateX.current;
      startTranslateY.current = translateY.current;
    })
    .onUpdate((e) => {
      translateX.current = startTranslateX.current + e.translationX;
      translateY.current = startTranslateY.current + e.translationY;
      setTransform({ x: translateX.current, y: translateY.current, s: scale.current });
    })
    .runOnJS(true);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.current = scale.current;
    })
    .onUpdate((e) => {
      scale.current = Math.max(0.15, Math.min(5, startScale.current * e.scale));
      setTransform({ x: translateX.current, y: translateY.current, s: scale.current });
    })
    .runOnJS(true);

  const tap = Gesture.Tap()
    .maxDuration(250)
    .maxDistance(10)
    .onEnd((e) => {
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;
      const cx = width / 2 + translateX.current;
      const cy = (height - 60) / 2 + translateY.current;
      const gx = (e.x - cx) / scale.current;
      const gy = (e.y - cy) / scale.current;

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
    scale.current = newScale;
    translateX.current = -centerX * newScale;
    translateY.current = -centerY * newScale;
    commitTransform();
  }, [width, height, commitTransform]);

  const handleZoom = useCallback(
    (factor: number) => {
      scale.current = Math.max(0.15, Math.min(5, scale.current * factor));
      commitTransform();
    },
    [commitTransform],
  );

  // Read live node positions on each tick-triggered re-render
  const nodes = nodesRef.current;
  const links = graph.data?.links ?? [];
  const nodePosMap = new Map(nodes.map((n) => [n.id, n]));

  // Build the "neighbourhood" of the selected node — used to dim everything else
  const focusedIds: Set<string> | null = selectedNode
    ? (() => {
        const ids = new Set<string>([selectedNode.id]);
        for (const l of links) {
          if (l.source === selectedNode.id) ids.add(l.target);
          if (l.target === selectedNode.id) ids.add(l.source);
        }
        return ids;
      })()
    : null;

  const svgTransform = `translate(${width / 2 + transform.x}, ${(height - 60) / 2 + transform.y}) scale(${transform.s})`;

  const stats = graph.data
    ? `${graph.data.nodes.length} notes · ${links.filter((l) => l.source !== l.target).length} links`
    : "";

  const edgeDimColor = T.isDark ? "rgba(140,120,200,0.22)" : "rgba(100,80,160,0.18)";

  // Suppress unused-var lint: tick drives re-renders via setTick
  void tick;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Knowledge Graph"
        color={DOMAIN_COLORS.notes}
        icon="notes"
        onBack={() => router.back()}
      />

      {graph.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.notes} />
        </View>
      ) : graph.data && graph.data.nodes.length === 0 ? (
        <EmptyGraph T={T} />
      ) : (
        <Animated.View style={[styles.canvas, graphAnimStyle]}>
          <GestureDetector gesture={composed}>
            <View style={StyleSheet.absoluteFill}>
              <Svg width={width} height={height - 60} style={styles.svg}>
                <G transform={svgTransform}>
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
                            stroke={DOMAIN_COLORS.notes}
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
                            stroke={DOMAIN_COLORS.notes}
                            strokeWidth={2}
                            strokeOpacity={0.5}
                            strokeLinecap="round"
                          />
                          {/* Flowing arrow particles — always outward from selected */}
                          {flowingArrows(
                            ax1,
                            ay1,
                            ax2,
                            ay2,
                            edgePhaseSelectedRef.current,
                            DOMAIN_COLORS.notes,
                          )}
                        </G>
                      );
                    })}

                  {/* Animated pulse ring for selected node */}
                  {selectedNode && (
                    <AnimatedCircle
                      cx={selectedNode.x}
                      cy={selectedNode.y}
                      fill={selectedNode.color}
                      animatedProps={pulseProps}
                    />
                  )}

                  {/* Nodes */}
                  {nodes.map((node) => {
                    const r = getNodeRadius(node.connections);
                    const isSelected = selectedNode?.id === node.id;
                    const isDimmed = focusedIds !== null && !focusedIds.has(node.id);
                    const dimOpacity = isDimmed ? 0.15 : 1;
                    return (
                      <G key={node.id} opacity={dimOpacity}>
                        {/* Layered glow rings */}
                        <Circle
                          cx={node.x}
                          cy={node.y}
                          r={r * 3}
                          fill={node.color}
                          fillOpacity={0.04}
                        />
                        <Circle
                          cx={node.x}
                          cy={node.y}
                          r={r * 2}
                          fill={node.color}
                          fillOpacity={0.08}
                        />
                        <Circle
                          cx={node.x}
                          cy={node.y}
                          r={r * 1.4}
                          fill={node.color}
                          fillOpacity={0.15}
                        />
                        {/* Main fill */}
                        <Circle
                          cx={node.x}
                          cy={node.y}
                          r={r}
                          fill={node.color}
                          fillOpacity={node.isNote ? 1 : 0.75}
                          stroke={isSelected ? "#fff" : node.color}
                          strokeWidth={isSelected ? 2 : 0}
                        />
                        {/* Specular highlight */}
                        <Circle
                          cx={node.x - r * 0.22}
                          cy={node.y - r * 0.28}
                          r={r * 0.45}
                          fill="rgba(255,255,255,0.22)"
                        />
                        <SvgText
                          x={node.x}
                          y={node.y + r + 10}
                          textAnchor="middle"
                          fontSize={9}
                          fontFamily="Inter_400Regular"
                          fill={T.isDark ? "rgba(255,255,255,0.75)" : "rgba(30,30,40,0.8)"}
                        >
                          {node.label.length > 16 ? node.label.slice(0, 14) + "\u2026" : node.label}
                        </SvgText>
                      </G>
                    );
                  })}
                </G>
              </Svg>
            </View>
          </GestureDetector>

          {/* Stats bar */}
          <View style={styles.statsBar} pointerEvents="none">
            <Text style={[styles.statsText, { color: T.textDim }]}>{stats}</Text>
          </View>

          {/* Zoom controls */}
          <View style={styles.zoomControls}>
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
            <View style={[styles.nodeCard, { backgroundColor: T.surface, borderColor: T.border }]}>
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
                    {!selectedNode.isNote && " · external"}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedNode(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={16} color={T.textDim} weight="duotone" />
                </TouchableOpacity>
              </View>
              {selectedNode.isNote && (
                <TouchableOpacity
                  style={[styles.nodeCardBtn, { backgroundColor: DOMAIN_COLORS.notes }]}
                  onPress={() => {
                    setSelectedNode(null);
                    router.push(`/notes/${selectedNode.id}` as any);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.nodeCardBtnText}>Open note</Text>
                </TouchableOpacity>
              )}
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
      <View style={[styles.emptyIcon, { backgroundColor: DOMAIN_COLORS.notesSoft }]}>
        <NotePencil size={36} color={DOMAIN_COLORS.notes} weight="duotone" />
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
  canvas: { flex: 1 },
  svg: { flex: 1 },
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
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  statsBar: {
    position: "absolute",
    top: 12,
    left: 16,
  },
  statsText: { fontSize: 11, fontFamily: "Inter_400Regular" },
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
  nodeCardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  nodeCardMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  nodeCardBtn: {
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  nodeCardBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
