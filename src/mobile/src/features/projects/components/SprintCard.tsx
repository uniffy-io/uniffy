import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { CaretDown, CaretRight, Play, CheckCircle, Trash } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { FONT } from "@theme/typography";
import { formatMinutes } from "@features/projects/timeFormatting";
import { BacklogTaskRow } from "@features/projects/components/BacklogTaskRow";
import { DONE_STATUS_ID } from "@features/projects/projectsSerializer";
import type {
  SerializedSprint,
  SerializedTask,
  PlainSelectOption,
} from "@features/projects/projectsSerializer";

const STATUS_LABEL: Record<SerializedSprint["status"], string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};

export function SprintCard({
  sprint,
  tasks,
  projectSlug,
  statusOptions,
  priorityOptions,
  accentColor,
  canEdit,
  canMoveTasks,
  busy,
  onOpenTask,
  onMoveTask,
  onStart,
  onComplete,
  onDelete,
}: {
  sprint: SerializedSprint;
  tasks: SerializedTask[];
  projectSlug: string;
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  canEdit: boolean;
  canMoveTasks: boolean;
  busy: boolean;
  onOpenTask: (taskId: string) => void;
  onMoveTask: (task: SerializedTask) => void;
  /** Absent on the sprints whose lifecycle button this card does not render. */
  onStart?: () => void;
  onComplete?: () => void;
  onDelete: () => void;
}) {
  const T = useTheme();
  // A closed sprint is history; it opens on demand rather than taking up the
  // screen every time the board is opened.
  const [collapsed, setCollapsed] = useState(sprint.status === "closed");

  const done = tasks.filter((t) => t.status === DONE_STATUS_ID).length;
  const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const estimated = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const spent = tasks.reduce((sum, t) => sum + (t.timeSpentMinutes ?? 0), 0);

  const dateRange =
    sprint.startDate && sprint.endDate
      ? `${sprint.startDate} - ${sprint.endDate}`
      : sprint.startDate
        ? `From ${sprint.startDate}`
        : sprint.endDate
          ? `Until ${sprint.endDate}`
          : null;

  const statusTint =
    sprint.status === "active" ? T.green : sprint.status === "closed" ? T.textDim : T.blue;

  return (
    <View style={[styles.card, { backgroundColor: T.bg, borderColor: T.border }]}>
      <TouchableOpacity
        style={[styles.header, { borderBottomColor: T.border }]}
        onPress={() => setCollapsed(!collapsed)}
        activeOpacity={0.7}
      >
        <View style={styles.headerTop}>
          {collapsed ? (
            <CaretRight size={14} color={T.textDim} weight="bold" />
          ) : (
            <CaretDown size={14} color={T.textDim} weight="bold" />
          )}
          <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
            {sprint.name}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: statusTint + "22" }]}>
            <Text style={[styles.statusText, { color: statusTint }]}>
              {STATUS_LABEL[sprint.status]}
            </Text>
          </View>
        </View>

        {sprint.goal ? (
          <Text style={[styles.goal, { color: T.textDim }]} numberOfLines={2}>
            {sprint.goal}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: T.textDim }]}>
            {done}/{tasks.length} done ({progress}%)
          </Text>
          {estimated > 0 && (
            <Text style={[styles.meta, { color: T.textDim }]}>
              {formatMinutes(spent)} / {formatMinutes(estimated)}
            </Text>
          )}
          {dateRange && <Text style={[styles.meta, { color: T.textDim }]}>{dateRange}</Text>}
        </View>

        <View style={[styles.progressTrack, { backgroundColor: T.surfaceHover }]}>
          <View
            style={[styles.progressFill, { width: `${progress}%`, backgroundColor: accentColor }]}
          />
        </View>
      </TouchableOpacity>

      {canEdit && (
        <View style={[styles.actions, { borderBottomColor: T.border }]}>
          {sprint.status === "planned" && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: T.border }]}
              onPress={() => onStart?.()}
              activeOpacity={0.7}
              disabled={busy}
            >
              <Play size={14} color={T.green} weight="fill" />
              <Text style={[styles.actionText, { color: T.text }]}>Start sprint</Text>
            </TouchableOpacity>
          )}
          {sprint.status === "active" && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: T.border }]}
              onPress={() => onComplete?.()}
              activeOpacity={0.7}
              disabled={busy}
            >
              <CheckCircle size={14} color={accentColor} weight="fill" />
              <Text style={[styles.actionText, { color: T.text }]}>Complete sprint</Text>
            </TouchableOpacity>
          )}
          {/* Delete stays on a closed sprint too - it is the only way to clear
              a mistaken one out of the history. */}
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: T.border }]}
            activeOpacity={0.7}
            disabled={busy}
            onPress={() =>
              confirmDestructive({
                title: "Delete sprint",
                message: `"${sprint.name}" will be deleted. Its ${tasks.length} task${tasks.length === 1 ? "" : "s"} move back to the backlog.`,
                onConfirm: onDelete,
              })
            }
          >
            <Trash size={14} color={T.red} weight="duotone" />
            <Text style={[styles.actionText, { color: T.red }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {!collapsed &&
        (tasks.length === 0 ? (
          <Text style={[styles.empty, { color: T.textDim }]}>No tasks in this sprint.</Text>
        ) : (
          tasks.map((task) => (
            <BacklogTaskRow
              key={task.id}
              task={task}
              projectSlug={projectSlug}
              statusOptions={statusOptions}
              priorityOptions={priorityOptions}
              canMove={canMoveTasks}
              onPress={() => onOpenTask(task.id)}
              onMove={() => onMoveTask(task)}
            />
          ))
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  header: { gap: 7, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { flex: 1, fontSize: 15, fontFamily: FONT.semibold },
  statusPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: FONT.semibold },
  goal: { fontSize: 12, fontFamily: FONT.regular },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  meta: { fontSize: 11, fontFamily: FONT.regular },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  actions: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: { fontSize: 12, fontFamily: FONT.medium },
  empty: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center", paddingVertical: 20 },
});
