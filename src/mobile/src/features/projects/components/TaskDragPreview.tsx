import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { TaskPriorityBadge } from "@features/projects/components/TaskPriorityBadge";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

/**
 * The card that rides the finger during a drag. It sits outside both scroll
 * views so it keeps following the finger while the board scrolls underneath.
 */
export function TaskDragPreview({
  task,
  priorityOptions,
  accentColor,
  style,
}: {
  task: SerializedTask;
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  style: object;
}) {
  const T = useTheme();
  const TypeIcon = getTaskTypeConfig(task.taskType).Icon;

  return (
    <Animated.View
      style={[styles.preview, { backgroundColor: T.bg, borderColor: accentColor }, style]}
      pointerEvents="none"
    >
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <TypeIcon size={14} color={T.textDim} weight="duotone" />
        </View>
        <Text style={[styles.title, { color: T.textBright }]} numberOfLines={2}>
          {task.title}
        </Text>
      </View>
      {task.priority ? (
        <View style={styles.meta}>
          <TaskPriorityBadge priority={task.priority} options={priorityOptions} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  preview: {
    position: "absolute",
    left: 0,
    top: 0,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  titleIcon: { height: 19, justifyContent: "center" },
  title: { flex: 1, fontSize: 13, fontFamily: FONT.medium, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
});
