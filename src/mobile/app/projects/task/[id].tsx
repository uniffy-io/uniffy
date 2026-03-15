import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  DotsThree,
  ArrowUp,
  Check,
  CaretRight,
  Warning,
  CalendarBlank,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { CalendarPicker } from "@/components/CalendarPicker";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS, BOTTOM_NAV_HEIGHT } from "@/constants/theme";
import { useTask, useProject, useProjectTasks, useTaskActivities } from "@/hooks/useProjects";
import { useUpdateTask } from "@/hooks/useProjectMutations";
import {
  getStatusOptions,
  getPriorityOptions,
  getOptionById,
  activityActionLabel,
} from "@/lib/projectsSerializer";
import type { SerializedTask, PlainSelectOption } from "@/lib/projectsSerializer";

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();

  const taskQuery = useTask(id);
  const task = taskQuery.data;
  const projectQuery = useProject(task?.projectId);
  const project = projectQuery.data;
  const tasksQuery = useProjectTasks(task?.projectId);
  const allTasks = tasksQuery.data ?? [];
  const activitiesQuery = useTaskActivities(id);
  const activities = activitiesQuery.data ?? [];
  const updateTask = useUpdateTask();

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  if (taskQuery.isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={DOMAIN_COLORS.projects} />
      </View>
    );
  }

  if (!task) return null;

  const statusOptions = project ? getStatusOptions(project) : [];
  const priorityOptions = project ? getPriorityOptions(project) : [];
  const statusOpt = getOptionById(statusOptions, task.status);
  const priorityOpt = getOptionById(priorityOptions, task.priority);
  const projectColor = project?.color || DOMAIN_COLORS.projects;

  const subtasks = allTasks.filter((t) => t.parentId === task.id);
  const subtasksDone = subtasks.filter((t) => t.completedAt).length;

  const blockers = task.blockedByTaskIds
    .map((blockId) => allTasks.find((t) => t.id === blockId))
    .filter(Boolean) as SerializedTask[];

  function toggleSubtask(sub: SerializedTask) {
    const isNowDone = !sub.completedAt;
    updateTask.mutate({
      taskId: sub.id,
      projectId: task!.projectId,
      status: isNowDone ? statusOptions[statusOptions.length - 1]?.id : statusOptions[0]?.id,
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={project?.name ?? "Projects"}
        color={projectColor}
        icon="projects"
        rightActions={
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <DotsThree size={22} color={T.text} weight="bold" />
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badges}>
          {statusOpt && (
            <View style={[styles.badge, { backgroundColor: statusOpt.color + "18" }]}>
              <View style={[styles.badgeDot, { backgroundColor: statusOpt.color }]} />
              <Text style={[styles.badgeText, { color: statusOpt.color }]}>{statusOpt.label}</Text>
            </View>
          )}
          {priorityOpt && (
            <View style={[styles.badge, { backgroundColor: priorityOpt.color + "18" }]}>
              {(priorityOpt.label.toLowerCase().includes("high") ||
                priorityOpt.label.toLowerCase().includes("urgent")) && (
                <ArrowUp size={10} color={priorityOpt.color} weight="bold" />
              )}
              <Text style={[styles.badgeText, { color: priorityOpt.color }]}>
                {priorityOpt.label}
              </Text>
            </View>
          )}
          {task.blockedByTaskIds.length > 0 && (
            <View style={[styles.badge, { backgroundColor: "#ef444418" }]}>
              <Warning size={10} color="#ef4444" weight="bold" />
              <Text style={[styles.badgeText, { color: "#ef4444" }]}>Blocked</Text>
            </View>
          )}
        </View>

        <Text style={[styles.title, { color: T.textBright }]}>{task.title}</Text>

        <View style={[styles.metaCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={[styles.metaRow, { borderBottomColor: T.border }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Status</Text>
            <Text style={[styles.metaText, { color: statusOpt?.color ?? T.textBright }]}>
              {statusOpt?.label ?? task.status}
            </Text>
          </View>
          <View style={[styles.metaRow, { borderBottomColor: T.border }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Priority</Text>
            <Text style={[styles.metaText, { color: priorityOpt?.color ?? T.textBright }]}>
              {priorityOpt?.label ?? (task.priority || "None")}
            </Text>
          </View>
          <View style={[styles.metaRow, { borderBottomColor: T.border }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Assignees</Text>
            <Text style={[styles.metaText, { color: T.textBright }]}>
              {task.assigneeIds.length > 0 ? `${task.assigneeIds.length} assigned` : "None"}
            </Text>
          </View>
          <View style={[styles.metaRow, { borderBottomColor: T.border }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Project</Text>
            <Text style={[styles.metaText, { color: T.textBright }]}>{project?.name ?? ""}</Text>
          </View>
          <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Created</Text>
            <Text style={[styles.metaText, { color: T.textDim }]}>
              {formatRelativeTime(task.createdAt)}
            </Text>
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>DATES</Text>
          <View style={styles.datesRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.dateLabel, { color: T.textDim }]}>Start</Text>
              <CalendarPicker
                value={task.startDate}
                onChange={(date) =>
                  updateTask.mutate({ taskId: task.id, projectId: task.projectId, startDate: date })
                }
                placeholder="No start date"
                accentColor={projectColor}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.dateLabel, { color: T.textDim }]}>Due</Text>
              <CalendarPicker
                value={task.dueDate}
                onChange={(date) =>
                  updateTask.mutate({ taskId: task.id, projectId: task.projectId, dueDate: date })
                }
                placeholder="No due date"
                accentColor={projectColor}
              />
            </View>
          </View>
        </View>

        {task.description ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>DESCRIPTION</Text>
            <Text style={[styles.description, { color: T.text }]}>{task.description}</Text>
          </View>
        ) : null}

        {blockers.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>
              BLOCKED BY - {blockers.length}
            </Text>
            {blockers.map((blocker) => {
              const blockerStatus = getOptionById(statusOptions, blocker.status);
              const isDone = !!blocker.completedAt;
              return (
                <TouchableOpacity
                  key={blocker.id}
                  style={[styles.blockerRow, { backgroundColor: T.surface, borderColor: T.border }]}
                  onPress={() => router.push(`/projects/task/${blocker.id}` as any)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.blockerDot,
                      { backgroundColor: blockerStatus?.color ?? T.textDim },
                    ]}
                  />
                  <Text
                    style={[
                      styles.blockerTitle,
                      {
                        color: isDone ? T.textDim : T.textBright,
                        textDecorationLine: isDone ? "line-through" : "none",
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {blocker.title}
                  </Text>
                  <CaretRight size={14} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {subtasks.length > 0 && (
          <View style={{ gap: 10 }}>
            <View style={styles.subtaskHeader}>
              <Text style={[styles.sectionLabel, { color: T.textDim }]}>SUBTASKS</Text>
              <Text style={[styles.subtaskProgress, { color: T.textDim }]}>
                {subtasksDone}/{subtasks.length} complete
              </Text>
            </View>
            {subtasks.map((sub) => {
              const done = !!sub.completedAt;
              return (
                <TouchableOpacity
                  key={sub.id}
                  style={styles.subtaskRow}
                  onPress={() => toggleSubtask(sub)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.subtaskCheck,
                      {
                        borderColor: done ? "#22c55e" : T.border,
                        backgroundColor: done ? "#22c55e" : "transparent",
                      },
                    ]}
                  >
                    {done && <Check size={10} color="#fff" weight="bold" />}
                  </View>
                  <Text
                    style={[
                      styles.subtaskTitle,
                      {
                        color: done ? T.textDim : T.textBright,
                        textDecorationLine: done ? "line-through" : "none",
                      },
                    ]}
                  >
                    {sub.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {activities.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>ACTIVITY</Text>
            {activities.map((act) => (
              <View key={act.id} style={styles.activityRow}>
                <View style={[styles.actorCircle, { backgroundColor: T.surfaceHover }]}>
                  <Text style={[styles.actorInitial, { color: T.textDim }]}>
                    {act.actorId.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.activityText, { color: T.text }]}>
                    {activityActionLabel(act.action)}
                  </Text>
                  {act.previousValue && act.newValue && (
                    <Text style={[styles.activityDetail, { color: T.textDim }]}>
                      {act.previousValue} {"->"} {act.newValue}
                    </Text>
                  )}
                </View>
                <Text style={[styles.activityTime, { color: T.textDim }]}>
                  {formatRelativeTime(act.timestamp)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 30 },
  metaCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  metaText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  datesRow: { flexDirection: "row", gap: 12 },
  dateLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  blockerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  blockerDot: { width: 8, height: 8, borderRadius: 4 },
  blockerTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  subtaskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subtaskProgress: { fontSize: 12, fontFamily: "Inter_400Regular" },
  subtaskRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  subtaskCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  subtaskTitle: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  actorCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actorInitial: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  activityText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  activityDetail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  activityTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
