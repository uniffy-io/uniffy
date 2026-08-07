import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import Animated, {
  runOnUI,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Path, Polygon } from "react-native-svg";
import { CaretDown, CaretRight, CalendarBlank, Check, Flag } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getOptionById } from "@features/projects/projectsSerializer";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import {
  buildRows,
  buildTimeline,
  barGeometry,
  computeRollupSpans,
  dependencyPath,
  formatSpan,
  isOverdue,
  taskBar,
  HEADER_HEIGHT,
  LABEL_WIDTH,
  MONTH_BAND_HEIGHT,
  PERIOD_BAND_HEIGHT,
  ROW_HEIGHT,
  ZOOM_LEVELS,
} from "@features/projects/roadmapLayout";
import type { SharedValue } from "react-native-reanimated";
import type {
  MonthBand,
  RoadmapRow,
  TaskBar,
  Timeline,
  ZoomLevel,
} from "@features/projects/roadmapLayout";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

const ZOOM_LABEL: Record<ZoomLevel, string> = { day: "Day", week: "Week", month: "Month" };
const BAR_HEIGHT = 22;
const ROLLUP_HEIGHT = 7;
const MILESTONE_SIZE = 13;
/** Leaves the today line a third of the way in, so the near future is on screen too. */
const TODAY_LEAD = 110;
/** Room "September 2026" needs, and so how far a month label may slide in its band. */
const MONTH_LABEL_WIDTH = 118;
const MIN_LABEL_WIDTH = 84;
const MAX_LABEL_WIDTH = 240;
const HANDLE_WIDTH = 18;

export function ProjectRoadmapView({
  tasks,
  statusOptions,
  accentColor,
  bottomPad,
  onOpenTask,
}: {
  tasks: SerializedTask[];
  statusOptions: PlainSelectOption[];
  accentColor: string;
  bottomPad: number;
  onOpenTask: (taskId: string) => void;
}) {
  const T = useTheme();
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  // The header follows the body on the UI thread rather than through a JS
  // onScroll callback, so the two cannot tear apart during a fast fling.
  const scrollX = useSharedValue(0);
  const bodyScroll = useAnimatedRef<Animated.ScrollView>();
  const onBodyScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const rollup = useMemo(() => computeRollupSpans(tasks), [tasks]);
  const bars = useMemo(() => {
    const map = new Map<string, TaskBar>();
    for (const task of tasks) {
      const bar = taskBar(task, rollup);
      if (bar) map.set(task.id, bar);
    }
    return map;
  }, [tasks, rollup]);

  const scheduled = useMemo(() => tasks.filter((t) => bars.has(t.id)), [tasks, bars]);
  const unscheduled = useMemo(() => tasks.filter((t) => !bars.has(t.id)), [tasks, bars]);
  const rows = useMemo(() => buildRows(scheduled, new Set(collapsed)), [scheduled, collapsed]);

  const timeline = useMemo(() => {
    const dates = [...bars.values()].flatMap((bar) => [bar.start, bar.end]);
    return buildTimeline(dates, zoom);
  }, [bars, zoom]);

  // scrollTo has to run on the UI thread for an animated ref; the ref's own
  // `current` is the animated wrapper, not a scrollable.
  const scrollToToday = useCallback(
    (animated: boolean) => {
      const x = Math.max(0, timeline.todayX - TODAY_LEAD);
      runOnUI(() => {
        "worklet";
        scrollTo(bodyScroll, x, 0, animated);
      })();
    },
    [bodyScroll, timeline.todayX],
  );

  // The window is rebuilt on every zoom change, so the offset that framed today
  // no longer means the same date - re-frame it instead of leaving the user
  // somewhere arbitrary in the new scale.
  useEffect(() => {
    const id = setTimeout(() => scrollToToday(false), 0);
    return () => clearTimeout(id);
  }, [scrollToToday]);

  const toggleCollapsed = (taskId: string) =>
    setCollapsed((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );

  // The split lives in a shared value, so dragging it resizes both panes on the
  // UI thread - the timeline is the flex sibling and follows for free.
  const labelWidth = useSharedValue(LABEL_WIDTH);
  const dragStart = useSharedValue(LABEL_WIDTH);
  const resize = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart(() => {
      dragStart.value = labelWidth.value;
    })
    .onChange((event) => {
      labelWidth.value = Math.min(
        Math.max(dragStart.value + event.translationX, MIN_LABEL_WIDTH),
        MAX_LABEL_WIDTH,
      );
    });
  const paneStyle = useAnimatedStyle(() => ({ width: labelWidth.value }));
  const handleStyle = useAnimatedStyle(() => ({ left: labelWidth.value - HANDLE_WIDTH / 2 }));

  if (tasks.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <CalendarBlank size={30} color={T.textDim} weight="duotone" />
        <Text style={[styles.emptyText, { color: T.textDim }]}>Nothing to plan yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={[styles.toolbar, { borderBottomColor: T.border }]}>
        <TouchableOpacity
          style={[styles.todayBtn, { borderColor: T.border, backgroundColor: T.pageBg }]}
          onPress={() => scrollToToday(true)}
          activeOpacity={0.7}
        >
          <CalendarBlank size={14} color={accentColor} weight="duotone" />
          <Text style={[styles.todayText, { color: T.text }]}>Today</Text>
        </TouchableOpacity>

        <View style={[styles.zoomToggle, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          {ZOOM_LEVELS.map((level) => {
            const active = zoom === level;
            return (
              <TouchableOpacity
                key={level}
                style={[styles.zoomBtn, active && { backgroundColor: accentColor }]}
                onPress={() => setZoom(level)}
                activeOpacity={0.7}
              >
                <Text style={[styles.zoomText, { color: active ? "#fff" : T.textDim }]}>
                  {ZOOM_LABEL[level]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.fill}>
        <View style={[styles.headerRow, { borderBottomColor: T.border, backgroundColor: T.bg }]}>
          <Animated.View style={[styles.headerCorner, { borderRightColor: T.border }, paneStyle]}>
            <Text style={[styles.cornerText, { color: T.textDim }]} numberOfLines={1}>
              {rows.length} task{rows.length === 1 ? "" : "s"}
            </Text>
          </Animated.View>
          <View style={styles.headerClip}>
            <TimelineHeader
              timeline={timeline}
              zoom={zoom}
              accentColor={accentColor}
              scrollX={scrollX}
            />
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomPad }}
        >
          <View style={styles.gantt}>
            <Animated.View style={[styles.labels, { borderRightColor: T.border }, paneStyle]}>
              {rows.map((row) => (
                <RoadmapLabel
                  key={row.task.id}
                  row={row}
                  bar={bars.get(row.task.id)}
                  collapsed={collapsed.includes(row.task.id)}
                  onToggle={() => toggleCollapsed(row.task.id)}
                  onPress={() => onOpenTask(row.task.id)}
                />
              ))}
            </Animated.View>

            <Animated.ScrollView
              ref={bodyScroll}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onBodyScroll}
            >
              <View style={{ width: timeline.width, height: rows.length * ROW_HEIGHT }}>
                <TimelineGrid timeline={timeline} rowCount={rows.length} />
                <DependencyLayer
                  rows={rows}
                  bars={bars}
                  timeline={timeline}
                  zoom={zoom}
                  color={T.textDim}
                />

                {rows.map((row, index) => {
                  const bar = bars.get(row.task.id)!;
                  const color = getOptionById(statusOptions, row.task.status)?.color ?? T.textDim;
                  return (
                    <TouchableOpacity
                      key={row.task.id}
                      style={[styles.barRow, { top: index * ROW_HEIGHT }]}
                      onPress={() => onOpenTask(row.task.id)}
                      activeOpacity={0.8}
                    >
                      <RoadmapBar
                        bar={bar}
                        task={row.task}
                        timeline={timeline}
                        zoom={zoom}
                        color={color}
                      />
                    </TouchableOpacity>
                  );
                })}

                {timeline.todayX >= 0 && timeline.todayX <= timeline.width && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.todayLine,
                      { left: timeline.todayX, backgroundColor: accentColor },
                    ]}
                  />
                )}
              </View>
            </Animated.ScrollView>
          </View>

          {unscheduled.length > 0 && (
            <UnscheduledSection tasks={unscheduled} onOpenTask={onOpenTask} />
          )}
        </ScrollView>

        {/* Sits over the seam rather than inside either pane: the label column
          scrolls with the rows and the timeline scrolls sideways, so neither
          could hold a grip that stays on the divider. */}
        <GestureDetector gesture={resize}>
          <Animated.View style={[styles.resizeHandle, handleStyle]}>
            <View style={[styles.resizeGrip, { backgroundColor: T.border }]} />
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

function DependencyLayer({
  rows,
  bars,
  timeline,
  zoom,
  color,
}: {
  rows: RoadmapRow[];
  bars: Map<string, TaskBar>;
  timeline: Timeline;
  zoom: ZoomLevel;
  color: string;
}) {
  const links = useMemo(() => {
    const rowIndex = new Map(rows.map((row, index) => [row.task.id, index]));
    const out: { key: string; path: string; ex: number; ey: number }[] = [];

    for (const row of rows) {
      const to = bars.get(row.task.id);
      const toIndex = rowIndex.get(row.task.id);
      if (!to || toIndex === undefined) continue;

      for (const blockerId of row.task.blockedByTaskIds) {
        const from = bars.get(blockerId);
        const fromIndex = rowIndex.get(blockerId);
        // A blocker that is filtered out, collapsed away, or unscheduled has no
        // anchor to draw from - the dependency still exists, it just has no line.
        if (!from || fromIndex === undefined) continue;

        const fromGeo = barGeometry(from, timeline.start, zoom);
        const toGeo = barGeometry(to, timeline.start, zoom);
        const sx = fromGeo.left + fromGeo.width;
        const sy = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const ex = toGeo.left - 5;
        const ey = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        out.push({
          key: `${blockerId}-${row.task.id}`,
          path: dependencyPath(sx, sy, ex, ey),
          ex,
          ey,
        });
      }
    }
    return out;
  }, [rows, bars, timeline, zoom]);

  if (links.length === 0) return null;

  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width={timeline.width}
      height={rows.length * ROW_HEIGHT}
    >
      {links.map((link) => (
        <React.Fragment key={link.key}>
          <Path
            d={link.path}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            fill="none"
            opacity={0.85}
          />
          <Polygon
            points={`${link.ex},${link.ey - 3.5} ${link.ex + 5},${link.ey} ${link.ex},${link.ey + 3.5}`}
            fill={color}
            opacity={0.85}
          />
        </React.Fragment>
      ))}
    </Svg>
  );
}

function TimelineHeader({
  timeline,
  zoom,
  accentColor,
  scrollX,
}: {
  timeline: Timeline;
  zoom: ZoomLevel;
  accentColor: string;
  scrollX: SharedValue<number>;
}) {
  const T = useTheme();
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));

  return (
    <Animated.View style={[{ width: timeline.width, height: HEADER_HEIGHT }, trackStyle]}>
      <View style={[styles.monthBand, { borderBottomColor: T.border }]}>
        {timeline.months.map((month) => (
          <MonthCell key={month.key} month={month} scrollX={scrollX} />
        ))}
      </View>

      <View style={styles.periodBand}>
        {timeline.columns.map((column) => (
          <View
            key={column.key}
            style={[
              styles.periodCell,
              { left: column.left, width: column.width },
              column.isWeekend && { backgroundColor: T.surfaceHover },
            ]}
          >
            {column.isToday ? (
              <View style={[styles.todayPill, { backgroundColor: accentColor }]}>
                <Text style={styles.todayPillText} numberOfLines={1}>
                  {column.label}
                </Text>
              </View>
            ) : (
              <Text
                style={[styles.periodText, { color: T.textDim }]}
                numberOfLines={1}
                // A week label is wider than a day number, so it is allowed to
                // shrink rather than truncate to "Au…".
                adjustsFontSizeToFit={zoom === "week"}
              >
                {column.label}
              </Text>
            )}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

/**
 * The month name slides along inside its own band while that band is the one on
 * screen, so a wide month scrolled halfway past still says which month it is.
 */
function MonthCell({ month, scrollX }: { month: MonthBand; scrollX: SharedValue<number> }) {
  const T = useTheme();
  const labelStyle = useAnimatedStyle(() => {
    const slack = Math.max(0, month.width - MONTH_LABEL_WIDTH);
    const offset = Math.min(Math.max(scrollX.value - month.left, 0), slack);
    return { transform: [{ translateX: offset }] };
  });

  return (
    <View
      style={[
        styles.monthCell,
        { left: month.left, width: month.width, borderLeftColor: T.border },
      ]}
    >
      <Animated.Text style={[styles.monthText, { color: T.text }, labelStyle]} numberOfLines={1}>
        {month.label}
      </Animated.Text>
    </View>
  );
}

function TimelineGrid({ timeline, rowCount }: { timeline: Timeline; rowCount: number }) {
  const T = useTheme();
  const height = rowCount * ROW_HEIGHT;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {timeline.columns.map((column) => (
        <View
          key={column.key}
          style={[
            styles.gridColumn,
            { left: column.left, width: column.width, height },
            column.isWeekend && { backgroundColor: T.surfaceHover + "80" },
            { borderLeftColor: column.startsMonth ? T.border : T.border + "60" },
          ]}
        />
      ))}
      {Array.from({ length: rowCount }, (_, i) => (
        <View
          key={`r${i}`}
          style={[
            styles.gridRow,
            { top: (i + 1) * ROW_HEIGHT - 1, borderBottomColor: T.border + "70" },
          ]}
        />
      ))}
    </View>
  );
}

function RoadmapLabel({
  row,
  bar,
  collapsed,
  onToggle,
  onPress,
}: {
  row: RoadmapRow;
  bar: TaskBar | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onPress: () => void;
}) {
  const T = useTheme();
  const { task, depth, hasChildren } = row;
  const done = !!task.completedAt;
  const range = bar ? formatSpan(bar.start, bar.end) : "";

  return (
    <TouchableOpacity
      style={[styles.labelCell, { borderBottomColor: T.border, paddingLeft: 8 + depth * 10 }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {hasChildren ? (
        <TouchableOpacity
          onPress={onToggle}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          style={styles.caret}
        >
          {collapsed ? (
            <CaretRight size={11} color={T.textDim} weight="bold" />
          ) : (
            <CaretDown size={11} color={T.textDim} weight="bold" />
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.caret} />
      )}
      <View style={styles.labelText}>
        <Text
          style={[
            styles.labelTitle,
            {
              color: done ? T.textDim : T.textBright,
              textDecorationLine: done ? "line-through" : "none",
            },
          ]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text
          style={[styles.labelRange, { color: isOverdue(task) ? T.red : T.textDim }]}
          numberOfLines={1}
        >
          {range}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function RoadmapBar({
  bar,
  task,
  timeline,
  zoom,
  color,
}: {
  bar: TaskBar;
  task: SerializedTask;
  timeline: Timeline;
  zoom: ZoomLevel;
  color: string;
}) {
  const T = useTheme();
  const geo = barGeometry(bar, timeline.start, zoom);
  const done = !!task.completedAt;
  const tint = done ? T.textDim : color;

  if (bar.kind === "milestone") {
    return (
      <View style={[styles.milestoneWrap, { left: geo.left - MILESTONE_SIZE / 2 }]}>
        <View style={[styles.milestone, { backgroundColor: tint }]} />
        <Text style={[styles.milestoneText, { color: T.text }]} numberOfLines={1}>
          {task.title}
        </Text>
      </View>
    );
  }

  if (bar.kind === "rollup") {
    // A summary bracket, not a bar: the parent owns no dates, it only spans
    // whatever its children ended up occupying.
    return (
      <View style={[styles.rollup, { left: geo.left, width: geo.width }]}>
        <View style={[styles.rollupBody, { backgroundColor: tint + "99" }]} />
        <View style={[styles.rollupCap, { backgroundColor: tint, left: 0 }]} />
        <View style={[styles.rollupCap, { backgroundColor: tint, right: 0 }]} />
      </View>
    );
  }

  const overdue = isOverdue(task);
  const progress =
    task.subtaskTotal > 0 ? Math.round((task.subtaskCompleted / task.subtaskTotal) * 100) : 0;
  // An open-ended task is anchored on the date it does have, so the missing end
  // reads as missing rather than as a one-day task.
  const left = bar.kind === "due" ? geo.left + geo.width - Math.max(geo.width, 26) : geo.left;
  const width = Math.max(geo.width, 26);
  const insideTitle = width >= 74;
  const titleStyle = {
    color: done ? T.textDim : T.textBright,
    textDecorationLine: done ? ("line-through" as const) : ("none" as const),
  };

  return (
    <>
      <View
        style={[
          styles.bar,
          {
            left,
            width,
            backgroundColor: tint + (done ? "18" : "2e"),
            borderColor: overdue ? T.red : tint + "70",
          },
        ]}
      >
        {progress > 0 && (
          <View
            pointerEvents="none"
            style={[styles.barProgress, { width: `${progress}%`, backgroundColor: tint + "3a" }]}
          />
        )}
        {done && <Check size={10} color={tint} weight="bold" />}
        {overdue && !done && <Flag size={10} color={T.red} weight="fill" />}
        {insideTitle && (
          <Text style={[styles.barText, titleStyle]} numberOfLines={1}>
            {task.title}
          </Text>
        )}
      </View>
      {/* A short bar has no room for a caption, and a nameless block on the
          timeline is unreadable without tracing back to the label column. */}
      {!insideTitle && (
        <Text
          style={[styles.barSideText, titleStyle, { left: left + width + 6 }]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
      )}
    </>
  );
}

function UnscheduledSection({
  tasks,
  onOpenTask,
}: {
  tasks: SerializedTask[];
  onOpenTask: (taskId: string) => void;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.unscheduled, { borderTopColor: T.border }]}>
      <TouchableOpacity
        style={styles.unscheduledHeader}
        onPress={() => setOpen((prev) => !prev)}
        activeOpacity={0.7}
      >
        {open ? (
          <CaretDown size={12} color={T.textDim} weight="bold" />
        ) : (
          <CaretRight size={12} color={T.textDim} weight="bold" />
        )}
        <Text style={[styles.unscheduledTitle, { color: T.text }]}>Unscheduled</Text>
        <View style={[styles.countPill, { backgroundColor: T.surfaceHover }]}>
          <Text style={[styles.countText, { color: T.textDim }]}>{tasks.length}</Text>
        </View>
      </TouchableOpacity>

      {open &&
        tasks.map((task) => {
          const TypeIcon = getTaskTypeConfig(task.taskType).Icon;
          return (
            <TouchableOpacity
              key={task.id}
              style={[styles.unscheduledRow, { borderTopColor: T.border }]}
              onPress={() => onOpenTask(task.id)}
              activeOpacity={0.7}
            >
              <TypeIcon size={12} color={T.textDim} weight="fill" />
              <Text style={[styles.unscheduledTask, { color: T.textBright }]} numberOfLines={1}>
                {task.title}
              </Text>
              <Text style={[styles.unscheduledHint, { color: T.textDim }]}>No dates</Text>
            </TouchableOpacity>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  todayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  todayText: { fontSize: 13, fontFamily: FONT.medium },
  zoomToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  zoomBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  zoomText: { fontSize: 13, fontFamily: FONT.medium },
  headerRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  headerClip: { flex: 1, overflow: "hidden" },
  resizeHandle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  resizeGrip: { width: 3, height: 34, borderRadius: 2 },
  headerCorner: {
    height: HEADER_HEIGHT,
    justifyContent: "flex-end",
    paddingBottom: 7,
    paddingHorizontal: 10,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  cornerText: { fontSize: 10, fontFamily: FONT.medium },
  monthBand: {
    height: MONTH_BAND_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthCell: {
    position: "absolute",
    top: 0,
    height: MONTH_BAND_HEIGHT,
    justifyContent: "center",
    paddingLeft: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  monthText: { fontSize: 11, fontFamily: FONT.semibold },
  periodBand: { height: PERIOD_BAND_HEIGHT },
  periodCell: {
    position: "absolute",
    top: 0,
    height: PERIOD_BAND_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  periodText: { fontSize: 10, fontFamily: FONT.medium, paddingHorizontal: 2 },
  todayPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 9 },
  todayPillText: { fontSize: 10, fontFamily: FONT.semibold, color: "#fff" },
  gantt: { flexDirection: "row" },
  labels: { borderRightWidth: StyleSheet.hairlineWidth },
  labelCell: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  caret: { width: 13, alignItems: "center" },
  labelText: { flex: 1, gap: 1 },
  labelTitle: { fontSize: 12, fontFamily: FONT.medium },
  labelRange: { fontSize: 9.5, fontFamily: FONT.regular },
  gridColumn: { position: "absolute", top: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  gridRow: { position: "absolute", left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  barRow: { position: "absolute", left: 0, right: 0, height: ROW_HEIGHT, justifyContent: "center" },
  bar: {
    position: "absolute",
    height: BAR_HEIGHT,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  barProgress: { position: "absolute", left: 0, top: 0, bottom: 0 },
  barText: { flex: 1, fontSize: 10.5, fontFamily: FONT.medium },
  barSideText: { position: "absolute", fontSize: 10.5, fontFamily: FONT.medium, maxWidth: 150 },
  rollup: { position: "absolute", height: ROLLUP_HEIGHT, justifyContent: "center" },
  rollupBody: { height: 4, borderRadius: 2 },
  rollupCap: { position: "absolute", width: 3, height: ROLLUP_HEIGHT, borderRadius: 1 },
  milestoneWrap: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 6 },
  milestone: {
    width: MILESTONE_SIZE,
    height: MILESTONE_SIZE,
    borderRadius: 2,
    transform: [{ rotate: "45deg" }],
  },
  milestoneText: { fontSize: 10.5, fontFamily: FONT.medium, maxWidth: 130 },
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 1.5, opacity: 0.7 },
  unscheduled: { borderTopWidth: StyleSheet.hairlineWidth },
  unscheduledHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  unscheduledTitle: { fontSize: 13, fontFamily: FONT.semibold },
  countPill: { minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  countText: { fontSize: 11, fontFamily: FONT.medium, textAlign: "center" },
  unscheduledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  unscheduledTask: { flex: 1, fontSize: 13, fontFamily: FONT.medium },
  unscheduledHint: { fontSize: 11, fontFamily: FONT.regular },
});
