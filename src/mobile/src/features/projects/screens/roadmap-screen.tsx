import React, { useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { CaretLeft, CaretRight } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProject, useProjectTasks } from "@features/projects/useProjects";
import { getStatusOptions, getOptionById } from "@features/projects/projectsSerializer";
import type { SerializedTask } from "@features/projects/projectsSerializer";

type ZoomLevel = "week" | "month";

const DAY_WIDTH_WEEK = 48;
const DAY_WIDTH_MONTH = 20;
const ROW_HEIGHT = 40;
const LABEL_WIDTH = 130;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatShortDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function getTimelineRange(
  tasks: SerializedTask[],
  zoom: ZoomLevel,
): { start: Date; end: Date; totalDays: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let earliest = new Date(today);
  let latest = addDays(today, zoom === "week" ? 14 : 60);

  tasks.forEach((task) => {
    if (task.startDate) {
      const d = new Date(task.startDate);
      if (d < earliest) earliest = new Date(d);
    }
    if (task.dueDate) {
      const d = new Date(task.dueDate);
      if (d > latest) latest = new Date(d);
    }
  });

  const start = addDays(earliest, -2);
  const end = addDays(latest, 3);
  const totalDays = diffDays(start, end);

  return { start, end, totalDays };
}

export default function RoadmapScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [zoom, setZoom] = useState<ZoomLevel>("month");

  const projectQuery = useProject(projectId);
  const tasksQuery = useProjectTasks(projectId);

  const project = projectQuery.data;
  const allTasks = tasksQuery.data ?? [];
  const tasks = allTasks.filter((t) => !t.parentId);
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const statusOptions = useMemo(() => (project ? getStatusOptions(project) : []), [project]);
  const projectColor = project?.color || T.accent;

  const dayWidth = zoom === "week" ? DAY_WIDTH_WEEK : DAY_WIDTH_MONTH;
  const { start: timelineStart, totalDays } = useMemo(
    () => getTimelineRange(tasks, zoom),
    [tasks, zoom],
  );
  const timelineWidth = totalDays * dayWidth;

  if (projectQuery.isLoading || tasksQuery.isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  if (!project) return null;

  const headerDates: { label: string; left: number }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(timelineStart, i);
    if (zoom === "week" || d.getDate() === 1 || i === 0) {
      headerDates.push({
        label: formatShortDate(d),
        left: i * dayWidth,
      });
    }
  }

  const todayOffset = diffDays(timelineStart, new Date()) * dayWidth;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Roadmap"
        color={projectColor}
        icon="projects"
        subtitle={project.name}
        rightActions={
          <View style={styles.zoomRow}>
            <TouchableOpacity
              style={[
                styles.zoomBtn,
                {
                  backgroundColor: zoom === "week" ? projectColor : T.surface,
                  borderColor: T.border,
                },
              ]}
              onPress={() => setZoom("week")}
            >
              <Text style={[styles.zoomText, { color: zoom === "week" ? "#fff" : T.textDim }]}>
                Week
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.zoomBtn,
                {
                  backgroundColor: zoom === "month" ? projectColor : T.surface,
                  borderColor: T.border,
                },
              ]}
              onPress={() => setZoom("month")}
            >
              <Text style={[styles.zoomText, { color: zoom === "month" ? "#fff" : T.textDim }]}>
                Month
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      <View style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomPad }}
        >
          <View style={styles.ganttContainer}>
            {/* Left labels column */}
            <View style={[styles.labelsColumn, { borderRightColor: T.border }]}>
              {/* Header spacer */}
              <View style={[styles.labelHeaderCell, { borderBottomColor: T.border }]}>
                <Text style={[styles.labelHeaderText, { color: T.textDim }]}>Task</Text>
              </View>
              {tasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  style={[styles.labelCell, { borderBottomColor: T.border }]}
                  onPress={() => router.push(`/projects/task/${task.id}` as any)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.labelText,
                      { color: task.completedAt ? T.textDim : T.textBright },
                    ]}
                    numberOfLines={1}
                  >
                    {task.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Right scrollable timeline */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ width: timelineWidth }}>
                {/* Date header */}
                <View style={[styles.timelineHeader, { borderBottomColor: T.border }]}>
                  {headerDates.map((hd, i) => (
                    <Text
                      key={i}
                      style={[
                        styles.dateHeaderText,
                        { color: T.textDim, left: hd.left, position: "absolute" },
                      ]}
                    >
                      {hd.label}
                    </Text>
                  ))}
                </View>

                {/* Grid rows + bars */}
                {tasks.map((task) => {
                  const statusOpt = getOptionById(statusOptions, task.status);
                  const barColor = statusOpt?.color ?? T.textDim;
                  const hasStart = !!task.startDate;
                  const hasEnd = !!task.dueDate;

                  let barLeft = 0;
                  let barWidth = 0;

                  if (hasStart && hasEnd) {
                    const startOffset = diffDays(timelineStart, new Date(task.startDate!));
                    const endOffset = diffDays(timelineStart, new Date(task.dueDate!));
                    barLeft = startOffset * dayWidth;
                    barWidth = Math.max((endOffset - startOffset + 1) * dayWidth, dayWidth);
                  } else if (hasStart) {
                    const startOffset = diffDays(timelineStart, new Date(task.startDate!));
                    barLeft = startOffset * dayWidth;
                    barWidth = dayWidth * 3;
                  } else if (hasEnd) {
                    const endOffset = diffDays(timelineStart, new Date(task.dueDate!));
                    barLeft = (endOffset - 2) * dayWidth;
                    barWidth = dayWidth * 3;
                  }

                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={[styles.timelineRow, { borderBottomColor: T.border }]}
                      onPress={() => router.push(`/projects/task/${task.id}` as any)}
                      activeOpacity={0.8}
                    >
                      {hasStart || hasEnd ? (
                        <View
                          style={[
                            styles.ganttBar,
                            {
                              left: barLeft,
                              width: barWidth,
                              backgroundColor: barColor + "30",
                              borderLeftColor: barColor,
                            },
                          ]}
                        >
                          <Text style={[styles.barText, { color: barColor }]} numberOfLines={1}>
                            {zoom === "week" ? task.title : ""}
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.noDatesText, { color: T.textDim }]}>No dates</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Today marker */}
                {todayOffset > 0 && todayOffset < timelineWidth && (
                  <View
                    style={[
                      styles.todayLine,
                      {
                        left: todayOffset,
                        height: ROW_HEIGHT * tasks.length + 32,
                        backgroundColor: projectColor,
                      },
                    ]}
                  />
                )}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  zoomRow: { flexDirection: "row", gap: 4 },
  zoomBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  zoomText: { fontSize: 12, fontFamily: FONT.medium },
  ganttContainer: { flexDirection: "row" },
  labelsColumn: { width: LABEL_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  labelHeaderCell: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelHeaderText: { fontSize: 11, fontFamily: FONT.semibold },
  labelCell: {
    height: ROW_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelText: { fontSize: 12, fontFamily: FONT.medium },
  timelineHeader: { height: 32, borderBottomWidth: StyleSheet.hairlineWidth },
  dateHeaderText: { fontSize: 10, fontFamily: FONT.medium, top: 10 },
  timelineRow: {
    height: ROW_HEIGHT,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ganttBar: {
    position: "absolute",
    top: 8,
    height: ROW_HEIGHT - 16,
    borderRadius: 4,
    borderLeftWidth: 3,
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  barText: { fontSize: 10, fontFamily: FONT.medium },
  noDatesText: { fontSize: 11, fontFamily: FONT.regular, paddingLeft: 12 },
  todayLine: { position: "absolute", top: 0, width: 1.5 },
});
