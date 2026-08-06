import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getOptionById } from "@features/projects/projectsSerializer";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

type ZoomLevel = "week" | "month";

const DAY_WIDTH_WEEK = 48;
const DAY_WIDTH_MONTH = 20;
const ROW_HEIGHT = 40;
const LABEL_WIDTH = 130;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatShortDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function getTimelineRange(tasks: SerializedTask[], zoom: ZoomLevel): { start: Date; days: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let earliest = new Date(today);
  let latest = addDays(today, zoom === "week" ? 14 : 60);

  for (const task of tasks) {
    if (task.startDate) {
      const d = new Date(task.startDate);
      if (d < earliest) earliest = new Date(d);
    }
    if (task.dueDate) {
      const d = new Date(task.dueDate);
      if (d > latest) latest = new Date(d);
    }
  }

  const start = addDays(earliest, -2);
  return { start, days: diffDays(start, addDays(latest, 3)) };
}

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
  const [zoom, setZoom] = useState<ZoomLevel>("month");

  // Subtasks ride with their parent bar rather than claiming a row of their own.
  const rows = useMemo(() => tasks.filter((t) => !t.parentId), [tasks]);
  const dayWidth = zoom === "week" ? DAY_WIDTH_WEEK : DAY_WIDTH_MONTH;
  const { start: timelineStart, days: totalDays } = useMemo(
    () => getTimelineRange(rows, zoom),
    [rows, zoom],
  );
  const timelineWidth = totalDays * dayWidth;

  const headerDates: { label: string; left: number }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(timelineStart, i);
    if (zoom === "week" || d.getDate() === 1 || i === 0) {
      headerDates.push({ label: formatShortDate(d), left: i * dayWidth });
    }
  }

  const todayOffset = diffDays(timelineStart, new Date()) * dayWidth;

  return (
    <View style={styles.fill}>
      <View style={[styles.zoomRow, { borderBottomColor: T.border }]}>
        {(["week", "month"] as ZoomLevel[]).map((level) => {
          const active = zoom === level;
          return (
            <TouchableOpacity
              key={level}
              style={[
                styles.zoomBtn,
                {
                  backgroundColor: active ? accentColor + "18" : T.pageBg,
                  borderColor: active ? accentColor : T.border,
                },
              ]}
              onPress={() => setZoom(level)}
              activeOpacity={0.7}
            >
              <Text style={[styles.zoomText, { color: active ? accentColor : T.textDim }]}>
                {level === "week" ? "Week" : "Month"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        <View style={styles.gantt}>
          <View style={[styles.labelsColumn, { borderRightColor: T.border }]}>
            <View style={[styles.labelHeaderCell, { borderBottomColor: T.border }]}>
              <Text style={[styles.labelHeaderText, { color: T.textDim }]}>Task</Text>
            </View>
            {rows.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={[styles.labelCell, { borderBottomColor: T.border }]}
                onPress={() => onOpenTask(task.id)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.labelText, { color: task.completedAt ? T.textDim : T.textBright }]}
                  numberOfLines={1}
                >
                  {task.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ width: timelineWidth }}>
              <View style={[styles.timelineHeader, { borderBottomColor: T.border }]}>
                {headerDates.map((hd) => (
                  <Text
                    key={hd.left}
                    style={[styles.dateHeaderText, { color: T.textDim, left: hd.left }]}
                  >
                    {hd.label}
                  </Text>
                ))}
              </View>

              {rows.map((task) => {
                const barColor = getOptionById(statusOptions, task.status)?.color ?? T.textDim;
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
                  barLeft = diffDays(timelineStart, new Date(task.startDate!)) * dayWidth;
                  barWidth = dayWidth * 3;
                } else if (hasEnd) {
                  barLeft = (diffDays(timelineStart, new Date(task.dueDate!)) - 2) * dayWidth;
                  barWidth = dayWidth * 3;
                }

                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[styles.timelineRow, { borderBottomColor: T.border }]}
                    onPress={() => onOpenTask(task.id)}
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

              {todayOffset > 0 && todayOffset < timelineWidth && (
                <View
                  style={[
                    styles.todayLine,
                    {
                      left: todayOffset,
                      height: ROW_HEIGHT * rows.length + 32,
                      backgroundColor: accentColor,
                    },
                  ]}
                />
              )}
            </View>
          </ScrollView>
        </View>

        {rows.length === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>No tasks to plot</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  zoomRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  zoomBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  zoomText: { fontSize: 12, fontFamily: FONT.medium },
  gantt: { flexDirection: "row" },
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
  dateHeaderText: { position: "absolute", top: 10, fontSize: 10, fontFamily: FONT.medium },
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
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 32 },
});
