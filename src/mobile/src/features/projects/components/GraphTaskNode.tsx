import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { CalendarBlank, ArrowElbowDownRight } from "phosphor-react-native";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { TaskPriorityBadge } from "@features/projects/components/TaskPriorityBadge";
import { NODE_W, NODE_H } from "@features/projects/graphLayout";
import type { LayoutNode, NodeState } from "@features/projects/graphLayout";
import type { PlainSelectOption } from "@features/projects/projectsSerializer";

const BADGE_LABEL: Record<NodeState, string | null> = {
  completed: null,
  blocker: "Blocker",
  blocked: "Blocked",
  free: "Free",
  neutral: null,
};

export function GraphTaskNode({
  node,
  projectSlug,
  statusColor,
  statusLabel,
  priorityOptions,
  stateColor,
  onCriticalPath,
  downstreamCount,
  onPress,
}: {
  node: LayoutNode;
  projectSlug: string;
  statusColor?: string;
  statusLabel?: string;
  priorityOptions: PlainSelectOption[];
  /** The colour the node's blocker state paints it, already resolved from the theme. */
  stateColor: string | null;
  onCriticalPath: boolean;
  downstreamCount: number;
  onPress: () => void;
}) {
  const T = useTheme();
  const TypeIcon = getTaskTypeConfig(node.taskType).Icon;
  const badge = BADGE_LABEL[node.state];

  return (
    <TouchableOpacity
      style={[
        styles.node,
        {
          left: node.x,
          top: node.y,
          backgroundColor: stateColor ? stateColor + "14" : T.bg,
          borderColor: onCriticalPath ? T.accent : (stateColor ?? T.border),
          borderWidth: onCriticalPath ? 2 : StyleSheet.hairlineWidth,
          opacity: node.completed ? 0.65 : 1,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.topRow}>
        {node.isSubtask && <ArrowElbowDownRight size={10} color={T.textDim} weight="bold" />}
        <TypeIcon size={11} color={T.textDim} weight="fill" />
        <Text style={[styles.number, { color: T.textDim }]} numberOfLines={1}>
          {projectSlug}-{node.number}
        </Text>
        <View style={styles.topRowEnd}>
          {node.priority ? (
            <TaskPriorityBadge priority={node.priority} options={priorityOptions} />
          ) : null}
          {onCriticalPath && downstreamCount > 0 && (
            <View style={[styles.impact, { backgroundColor: T.accent }]}>
              <Text style={styles.impactText}>{downstreamCount}</Text>
            </View>
          )}
          {badge && stateColor && (
            <View style={[styles.badge, { backgroundColor: stateColor + "22" }]}>
              <Text style={[styles.badgeText, { color: stateColor }]}>{badge}</Text>
            </View>
          )}
        </View>
      </View>

      <Text
        style={[
          styles.title,
          {
            color: node.completed ? T.textDim : T.textBright,
            textDecorationLine: node.completed ? "line-through" : "none",
          },
        ]}
        numberOfLines={2}
      >
        {node.title}
      </Text>

      <View style={styles.bottomRow}>
        <View style={styles.bottomLeft}>
          {statusColor && (
            <>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.meta, { color: T.textDim }]} numberOfLines={1}>
                {statusLabel}
              </Text>
            </>
          )}
          {node.dueDate && (
            <>
              <CalendarBlank size={10} color={T.textDim} weight="duotone" />
              <Text style={[styles.meta, { color: T.textDim }]}>{node.dueDate}</Text>
            </>
          )}
        </View>
        {node.assigneeIds.length > 0 && (
          <SubjectAvatarStack subjectIds={node.assigneeIds} size={16} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  node: {
    position: "absolute",
    width: NODE_W,
    height: NODE_H,
    borderRadius: 10,
    padding: 8,
    justifyContent: "space-between",
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  topRowEnd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    flexShrink: 0,
  },
  // Shrinks first: the badges beside it carry more than the task number does.
  number: { fontSize: 10, fontFamily: FONT.medium, flexShrink: 1 },
  impact: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  impactText: { fontSize: 9, fontFamily: FONT.bold, color: "#fff" },
  badge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  badgeText: { fontSize: 9, fontFamily: FONT.semibold },
  title: { flex: 1, fontSize: 12, fontFamily: FONT.medium, lineHeight: 16, marginTop: 4 },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  bottomLeft: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  meta: { fontSize: 10, fontFamily: FONT.regular },
});
