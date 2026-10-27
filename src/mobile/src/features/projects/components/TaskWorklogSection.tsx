import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Trash } from "phosphor-react-native";
import { useAuth } from "@core/providers/AuthContext";
import { Avatar } from "@shared/components/Avatar";
import { useDirectory } from "@shared/directory/useDirectory";
import { useTheme } from "@shared/hooks/useTheme";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { zonedParts } from "@shared/lib/zonedTime";
import { FONT } from "@theme/typography";
import { LogTimeSheet } from "@features/projects/components/LogTimeSheet";
import { endOf, wallOf } from "@features/projects/timeClock";
import { formatMinutes } from "@features/projects/timeFormatting";
import type { SerializedWorklog } from "@features/projects/timeSerializer";
import { formatDayLong } from "@features/projects/timeWeek";
import { useTaskWorklogs } from "@features/projects/useMyTime";
import { useDeleteWorklog, useUpdateWorklog } from "@features/projects/useTimeMutations";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const COLLAPSED_ROWS = 5;

function whenOf(entry: SerializedWorklog): string {
  const day = formatDayLong(entry.workDate);
  if (!entry.startedAt) return day;
  const parts = zonedParts(new Date(entry.startedAt));
  const start = wallOf(parts.hour * 60 + parts.minute);
  return `${day}, ${start} to ${endOf(start, entry.durationMinutes)}`;
}

/** Who logged what on the task; the person's own entries can be changed from here. */
export function TaskWorklogSection({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
  const T = useTheme();
  const { user } = useAuth();
  const { byId } = useDirectory();
  const worklogs = useTaskWorklogs(taskId);
  const updateWorklog = useUpdateWorklog();
  const deleteWorklog = useDeleteWorklog();
  const [editing, setEditing] = useState<SerializedWorklog | null>(null);
  const [expanded, setExpanded] = useState(false);

  const entries = worklogs.data ?? [];
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ROWS);

  const remove = (entry: SerializedWorklog) =>
    confirmDestructive({
      title: "Delete time entry",
      message: `Remove ${formatMinutes(entry.durationMinutes)} logged on ${formatDayLong(entry.workDate)}?`,
      onConfirm: () => deleteWorklog.mutate({ worklogId: entry.id, projectId: entry.projectId }),
    });

  return (
    <View style={{ gap: 10 }} testID="task-worklogs">
      <Text style={[styles.sectionLabel, { color: T.textDim }]}>
        TIME LOGGED{entries.length > 0 ? ` - ${entries.length}` : ""}
      </Text>
      {entries.length === 0 ? (
        <Text style={[styles.emptyHint, { color: T.textDim }]}>
          {worklogs.isLoading ? "Loading" : "No time logged yet"}
        </Text>
      ) : (
        <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
          {shown.map((entry, index) => {
            const mine = entry.userId === user?.id;
            const name = byId.get(entry.userId)?.name ?? "Someone";
            return (
              <TouchableOpacity
                key={entry.id}
                style={[
                  styles.row,
                  index > 0 && {
                    borderTopColor: T.border,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                onPress={() => setEditing(entry)}
                disabled={!mine}
                accessibilityLabel={`${formatMinutes(entry.durationMinutes)} by ${name} on ${formatDayLong(entry.workDate)}`}
                testID="task-worklog"
              >
                <Avatar name={name} avatarUrl={byId.get(entry.userId)?.avatarUrl} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.meta, { color: T.textDim }]} numberOfLines={1}>
                    {whenOf(entry)}
                  </Text>
                  {entry.description ? (
                    <Text style={[styles.note, { color: T.text }]} numberOfLines={2}>
                      {entry.description}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.minutes, { color: T.textBright }]}>
                  {formatMinutes(entry.durationMinutes)}
                </Text>
                {mine && (
                  <TouchableOpacity
                    hitSlop={HIT_SLOP}
                    onPress={() => remove(entry)}
                    accessibilityLabel="Delete entry"
                    testID="task-worklog-delete"
                  >
                    <Trash size={16} color={T.textDim} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
          {entries.length > COLLAPSED_ROWS && (
            <TouchableOpacity
              style={[styles.more, { borderTopColor: T.border }]}
              onPress={() => setExpanded((value) => !value)}
              testID="task-worklogs-more"
            >
              <Text style={[styles.moreLabel, { color: T.accent }]}>
                {expanded ? "Show fewer" : `Show all ${entries.length}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <LogTimeSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit time entry"
        taskTitle={taskTitle}
        initial={
          editing
            ? {
                workDate: editing.workDate,
                durationMinutes: editing.durationMinutes,
                description: editing.description,
                startedAt: editing.startedAt,
              }
            : undefined
        }
        saving={updateWorklog.isPending}
        onSave={(entry) => {
          if (!editing) return;
          updateWorklog.mutate(
            { worklogId: editing.id, ...entry },
            { onSuccess: () => setEditing(null) },
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  emptyHint: { fontSize: 13, fontFamily: FONT.regular },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  name: { fontSize: 14, fontFamily: FONT.semibold },
  meta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  note: { fontSize: 13, fontFamily: FONT.regular, marginTop: 3 },
  minutes: { fontSize: 14, fontFamily: FONT.semibold },
  more: { alignItems: "center", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  moreLabel: { fontSize: 13, fontFamily: FONT.semibold },
});
