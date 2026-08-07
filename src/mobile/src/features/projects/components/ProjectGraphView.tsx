import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Svg, { Path, Polygon } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  ShareNetwork,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowsIn,
  Lightning,
  TreeStructure,
} from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useProjectSprints } from "@features/projects/useProjects";
import { GraphTaskNode } from "@features/projects/components/GraphTaskNode";
import { buildGraphLayout, edgeGeometry, NODE_W, NODE_H } from "@features/projects/graphLayout";
import type { NodeState } from "@features/projects/graphLayout";
import type {
  SerializedProject,
  SerializedTask,
  PlainSelectOption,
} from "@features/projects/projectsSerializer";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const SETTLE_MS = 200;
const DIAMOND = 5;

interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ProjectGraphView({
  project,
  tasks,
  statusOptions,
  priorityOptions,
  accentColor,
  navInset,
  onOpenTask,
}: {
  project: SerializedProject;
  /**
   * Subtasks included: a dependency graph that hides children hides their
   * blockers too.
   */
  tasks: SerializedTask[];
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  /** Height of the floating nav the canvas runs underneath. */
  navInset: number;
  onOpenTask: (taskId: string) => void;
}) {
  const T = useTheme();
  const sprintsQuery = useProjectSprints(project.id);

  const sprints = useMemo(
    () => (sprintsQuery.data ?? []).filter((s) => s.status !== "closed"),
    [sprintsQuery.data],
  );

  const [showCriticalPath, setShowCriticalPath] = useState(false);
  // Parent/child links on by default; toggle off when the graph gets dense.
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [userView, setUserView] = useState<ViewTransform | null>(null);

  const layout = useMemo(() => buildGraphLayout(tasks, sprints), [tasks, sprints]);

  const statusById = useMemo(() => {
    const map = new Map<string, { color: string; label: string }>();
    for (const option of statusOptions) {
      map.set(option.id, { color: option.color, label: option.label });
    }
    return map;
  }, [statusOptions]);

  const stateColor = useMemo<Record<NodeState, string | null>>(
    () => ({
      completed: null,
      blocker: T.red,
      blocked: T.yellow,
      free: T.green,
      neutral: null,
    }),
    [T],
  );

  /** The transform that centres the whole graph, which is also where it starts. */
  const fitView = useMemo<ViewTransform>(() => {
    if (!layout || viewport.width === 0 || viewport.height === 0) return { scale: 1, x: 0, y: 0 };
    const scale = clamp(
      Math.min(viewport.width / layout.canvasWidth, viewport.height / layout.canvasHeight, 1) * 0.9,
      MIN_ZOOM,
      MAX_ZOOM,
    );
    return {
      scale,
      x: (viewport.width - layout.canvasWidth * scale) / 2,
      y: (viewport.height - layout.canvasHeight * scale) / 2,
    };
  }, [layout, viewport]);

  // Until the finger touches it the graph re-fits itself, so a task added on
  // another device does not leave the view pointing at empty canvas.
  const view = userView ?? fitView;

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Pan and pinch run simultaneously, and either one re-rendering the screen
  // would let the effect below animate the transform back to the last committed
  // one mid-gesture. Counted rather than flagged: lifting one finger of a pinch
  // ends that gesture while the pan keeps running, and a boolean would hand the
  // transform back to the effect with a finger still down.
  const activeGestures = useRef(0);
  const beginGesture = useCallback(() => {
    activeGestures.current += 1;
  }, []);
  const endGesture = useCallback(() => {
    activeGestures.current = Math.max(0, activeGestures.current - 1);
  }, []);

  useEffect(() => {
    if (activeGestures.current > 0) return;
    scale.value = withTiming(view.scale, { duration: SETTLE_MS });
    tx.value = withTiming(view.x, { duration: SETTLE_MS });
    ty.value = withTiming(view.y, { duration: SETTLE_MS });
  }, [view, scale, tx, ty]);

  // The gesture count is decremented by onFinalize, which always runs after
  // onEnd - committing must not clear it, or the surviving gesture is dropped.
  const commit = useCallback(
    (next: ViewTransform) => {
      setUserView(next);
    },
    [setUserView],
  );

  // Both gestures ADD to the transform rather than each writing it from its own
  // snapshot. Pinch and pan are simultaneous, so absolute writes would have the
  // two of them overwriting each other every frame, which reads as flicker.
  //
  // Rebuilt every render on purpose: nothing re-renders while a finger is down,
  // so the detector is never swapped mid-gesture, and memoizing would mean
  // listing shared values as hook deps.
  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onStart(() => {
      runOnJS(beginGesture)();
    })
    .onChange((event) => {
      tx.value += event.changeX;
      ty.value += event.changeY;
    })
    .onEnd(() => {
      runOnJS(commit)({ scale: scale.value, x: tx.value, y: ty.value });
    })
    // Also runs when the gesture is interrupted, so an aborted pan can never
    // leave the transform locked away from the effect above.
    .onFinalize(() => {
      runOnJS(endGesture)();
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      runOnJS(beginGesture)();
    })
    .onChange((event) => {
      const next = Math.min(Math.max(scale.value * event.scaleChange, MIN_ZOOM), MAX_ZOOM);
      // Hold the point under the fingers still: a canvas point sits at
      // `t + c * s`, so keeping it put means t' = focal - (focal - t) * s'/s.
      const factor = next / scale.value;
      tx.value = event.focalX - (event.focalX - tx.value) * factor;
      ty.value = event.focalY - (event.focalY - ty.value) * factor;
      scale.value = next;
    })
    .onEnd(() => {
      runOnJS(commit)({ scale: scale.value, x: tx.value, y: ty.value });
    })
    // Also runs when the gesture is interrupted, so an aborted pinch can never
    // leave the transform locked away from the effect above.
    .onFinalize(() => {
      runOnJS(endGesture)();
    });

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const zoomBy = (factor: number) => {
    const next = clamp(view.scale * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const canvasX = (cx - view.x) / view.scale;
    const canvasY = (cy - view.y) / view.scale;
    setUserView({ scale: next, x: cx - canvasX * next, y: cy - canvasY * next });
  };

  if (sprintsQuery.isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={accentColor} />
      </View>
    );
  }

  const nodeById = new Map((layout?.nodes ?? []).map((n) => [n.id, n]));
  const criticalPath = layout?.criticalPath;

  return (
    <View style={styles.container}>
      <View style={[styles.toolbar, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.legend}
        >
          <LegendDot color={T.red} label="Blocker" />
          <LegendDot color={T.yellow} label="Blocked" />
          <LegendDot color={T.green} label="Free" />
          <LegendDot color={T.textDim} label="Done" />
        </ScrollView>
        <View style={styles.toggles}>
          {layout && layout.containmentEdges.length > 0 && (
            <TogglePill
              active={showHierarchy}
              color={accentColor}
              onPress={() => setShowHierarchy(!showHierarchy)}
              Icon={TreeStructure}
              label="Subtasks"
            />
          )}
          <TogglePill
            active={showCriticalPath}
            color={accentColor}
            onPress={() => setShowCriticalPath(!showCriticalPath)}
            Icon={Lightning}
            label={
              showCriticalPath && criticalPath && criticalPath.pathLength > 0
                ? `Critical - ${criticalPath.pathLength}`
                : "Critical"
            }
          />
        </View>
      </View>

      <View
        style={styles.canvasArea}
        onLayout={(event) =>
          setViewport({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          })
        }
      >
        {!layout ? (
          <View style={styles.centered}>
            <ShareNetwork size={44} color={T.textDim} weight="duotone" />
            <Text style={[styles.emptyTitle, { color: T.textBright }]}>No tasks</Text>
            <Text style={[styles.emptyBody, { color: T.textDim }]}>
              Create tasks to see them and their dependencies here.
            </Text>
          </View>
        ) : (
          <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
            <Animated.View style={styles.clip}>
              <Animated.View
                style={[
                  styles.canvas,
                  { width: layout.canvasWidth, height: layout.canvasHeight },
                  canvasStyle,
                ]}
              >
                {layout.groups.map((group) => (
                  <View
                    key={group.sprintId ?? "__backlog__"}
                    style={[
                      styles.group,
                      {
                        left: group.bounds.x,
                        top: group.bounds.y,
                        width: group.bounds.width,
                        height: group.bounds.height,
                        borderColor: group.status === "active" ? accentColor : T.border,
                        backgroundColor:
                          group.status === "active" ? accentColor + "0d" : T.bg + "80",
                      },
                    ]}
                  >
                    <View style={styles.groupHeader}>
                      {group.status === "active" && (
                        <View style={[styles.groupDot, { backgroundColor: accentColor }]} />
                      )}
                      <Text style={[styles.groupLabel, { color: T.textDim }]} numberOfLines={1}>
                        {group.label}
                      </Text>
                    </View>
                  </View>
                ))}

                <Svg
                  width={layout.canvasWidth}
                  height={layout.canvasHeight}
                  style={styles.edgeLayer}
                  pointerEvents="none"
                >
                  {showHierarchy &&
                    layout.containmentEdges.map((edge) => {
                      const from = nodeById.get(edge.fromId);
                      const to = nodeById.get(edge.toId);
                      if (!from || !to) return null;
                      const geometry = edgeGeometry(from, to);
                      const cx = from.x + NODE_W;
                      const cy = from.y + NODE_H / 2;
                      return (
                        <React.Fragment key={`contain-${edge.fromId}-${edge.toId}`}>
                          <Path
                            d={geometry.path}
                            fill="none"
                            stroke={T.textDim}
                            strokeWidth={1.25}
                            strokeDasharray="2 5"
                            opacity={0.45}
                          />
                          <Polygon
                            points={`${cx},${cy - DIAMOND} ${cx + DIAMOND},${cy} ${cx},${cy + DIAMOND} ${cx - DIAMOND},${cy}`}
                            fill={T.textDim}
                            opacity={0.5}
                          />
                        </React.Fragment>
                      );
                    })}

                  {layout.edges.map((edge) => {
                    const from = nodeById.get(edge.fromId);
                    const to = nodeById.get(edge.toId);
                    if (!from || !to) return null;
                    const geometry = edgeGeometry(from, to);
                    const critical =
                      showCriticalPath &&
                      !!criticalPath?.pathEdges.has(`${edge.fromId}->${edge.toId}`);
                    const color = critical ? accentColor : edge.satisfied ? T.green : T.red;
                    const opacity = critical ? 1 : edge.satisfied ? 0.5 : 0.8;
                    return (
                      <React.Fragment key={`${edge.fromId}-${edge.toId}`}>
                        <Path
                          d={geometry.path}
                          fill="none"
                          stroke={color}
                          strokeWidth={critical ? 3 : 1.5}
                          strokeDasharray={!critical && edge.satisfied ? "5 3" : undefined}
                          opacity={opacity}
                        />
                        <Polygon points={geometry.arrow} fill={color} opacity={opacity} />
                      </React.Fragment>
                    );
                  })}
                </Svg>

                {layout.nodes.map((node) => {
                  const status = statusById.get(node.statusId);
                  return (
                    <GraphTaskNode
                      key={node.id}
                      node={node}
                      projectSlug={project.slug}
                      statusColor={status?.color}
                      statusLabel={status?.label}
                      priorityOptions={priorityOptions}
                      stateColor={stateColor[node.state]}
                      onCriticalPath={showCriticalPath && !!criticalPath?.pathNodeIds.has(node.id)}
                      downstreamCount={criticalPath?.downstreamCounts.get(node.id) ?? 0}
                      onPress={() => onOpenTask(node.id)}
                    />
                  );
                })}
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        )}

        {layout && (
          // The router slides screen content under the floating nav, so the
          // controls are parked on top of that block rather than on the edge.
          <View
            style={[
              styles.zoomBar,
              {
                backgroundColor: T.bg,
                borderColor: T.border,
                bottom: navInset + 12,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => zoomBy(0.8)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <MagnifyingGlassMinus size={17} color={T.text} weight="bold" />
            </TouchableOpacity>
            <Text style={[styles.zoomText, { color: T.textDim }]}>
              {Math.round(view.scale * 100)}%
            </Text>
            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => zoomBy(1.25)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <MagnifyingGlassPlus size={17} color={T.text} weight="bold" />
            </TouchableOpacity>
            <View style={[styles.zoomDivider, { backgroundColor: T.border }]} />
            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => setUserView(null)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ArrowsIn size={17} color={T.text} weight="bold" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const T = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: T.textDim }]}>{label}</Text>
    </View>
  );
}

function TogglePill({
  active,
  color,
  label,
  Icon,
  onPress,
}: {
  active: boolean;
  color: string;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; weight?: "fill" | "duotone" }>;
  onPress: () => void;
}) {
  const T = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.pill,
        {
          backgroundColor: active ? color + "18" : T.pageBg,
          borderColor: active ? color : T.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon size={13} color={active ? color : T.textDim} weight={active ? "fill" : "duotone"} />
      <Text style={[styles.pillText, { color: active ? color : T.textDim }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyTitle: { fontSize: 16, fontFamily: FONT.semibold, marginTop: 4 },
  emptyBody: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legend: { alignItems: "center", gap: 10, paddingRight: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 11, fontFamily: FONT.regular },
  toggles: { flexDirection: "row", alignItems: "center", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 11, fontFamily: FONT.semibold },
  canvasArea: { flex: 1 },
  clip: { flex: 1, overflow: "hidden" },
  canvas: { position: "absolute", left: 0, top: 0, transformOrigin: "0% 0%" },
  edgeLayer: { position: "absolute", left: 0, top: 0 },
  group: { position: "absolute", borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed" },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  zoomBar: {
    position: "absolute",
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  zoomBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  zoomText: { fontSize: 11, fontFamily: FONT.medium, width: 38, textAlign: "center" },
  zoomDivider: { width: StyleSheet.hairlineWidth, height: 16, marginHorizontal: 4 },
});
