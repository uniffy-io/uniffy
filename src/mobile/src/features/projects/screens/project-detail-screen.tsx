import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Animated,
  PanResponder,
} from "react-native";
import { Funnel, DotsThree, Plus, ArrowUp, Warning, CalendarBlank } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProject, useProjectTasks } from "@features/projects/useProjects";
import { useMoveTask, useDeleteProject } from "@features/projects/useProjectMutations";
import {
  getStatusOptions,
  getPriorityOptions,
  getOptionById,
  computeProjectStats,
} from "@features/projects/projectsSerializer";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

type ViewMode = "Table" | "Board" | "Roadmap";

function PriorityBadge({ priority, options }: { priority: string; options: PlainSelectOption[] }) {
  const opt = getOptionById(options, priority);
  if (!opt) return null;
  const color = opt.color;
  return (
    <View style={[styles.priorityBadge, { backgroundColor: color + "18" }]}>
      {opt.label.toLowerCase().includes("high") || opt.label.toLowerCase().includes("urgent") ? (
        <ArrowUp size={9} color={color} weight="bold" />
      ) : null}
      <Text style={[styles.priorityText, { color }]}>{opt.label}</Text>
    </View>
  );
}

function TaskCard({
  task,
  allTasks,
  priorityOptions,
  statusColor,
  onPress,
}: {
  task: SerializedTask;
  allTasks: SerializedTask[];
  priorityOptions: PlainSelectOption[];
  statusColor: string;
  onPress: () => void;
}) {
  const T = useTheme();
  const isDone = !!task.completedAt;
  const isBlocked = task.blockedByTaskIds.length > 0;
  const subtasks = allTasks.filter((t) => t.parentId === task.id);
  const subtasksDone = subtasks.filter((t) => t.completedAt).length;

  return (
    <TouchableOpacity
      style={[
        styles.taskCard,
        { backgroundColor: T.bg, borderColor: T.border, opacity: isDone ? 0.7 : 1 },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.taskTags}>
        {task.priority ? (
          <PriorityBadge priority={task.priority} options={priorityOptions} />
        ) : null}
        {isBlocked && (
          <View style={[styles.blockedBadge, { backgroundColor: "#ef444418" }]}>
            <Warning size={9} color="#ef4444" weight="bold" />
            <Text style={[styles.priorityText, { color: "#ef4444" }]}>Blocked</Text>
          </View>
        )}
      </View>

      <Text
        style={[
          styles.taskTitle,
          { color: T.textBright, textDecorationLine: isDone ? "line-through" : "none" },
        ]}
      >
        {task.title}
      </Text>

      <View style={styles.taskFooter}>
        <View style={styles.taskFooterLeft}>
          {task.dueDate ? (
            <View style={styles.dueDateRow}>
              <CalendarBlank size={11} color={T.textDim} weight="duotone" />
              <Text style={[styles.dueDateText, { color: T.textDim }]}>{task.dueDate}</Text>
            </View>
          ) : null}
          {subtasks.length > 0 && (
            <Text style={[styles.subtaskCount, { color: T.textDim }]}>
              {subtasksDone}/{subtasks.length}
            </Text>
          )}
        </View>
        {task.assigneeIds.length > 0 && (
          <View style={[styles.assigneeCount, { backgroundColor: T.surfaceHover }]}>
            <Text style={[styles.assigneeCountText, { color: T.textDim }]}>
              {task.assigneeIds.length}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ProjectBoardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = useState<ViewMode>("Table");
  const [sheetOpen, setSheetOpen] = useState(false);

  const projectQuery = useProject(id);
  const tasksQuery = useProjectTasks(id);
  const moveTask = useMoveTask();
  const deleteProject = useDeleteProject();

  const project = projectQuery.data;
  const tasks = tasksQuery.data ?? [];
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const statusOptions = useMemo(() => (project ? getStatusOptions(project) : []), [project]);
  const priorityOptions = useMemo(() => (project ? getPriorityOptions(project) : []), [project]);
  const stats = useMemo(() => computeProjectStats(tasks), [tasks]);

  const columns = useMemo(
    () =>
      statusOptions.map((opt) => ({
        key: opt.id,
        label: opt.label,
        color: opt.color,
      })),
    [statusOptions],
  );

  if (projectQuery.isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.domains.projects} />
      </View>
    );
  }

  if (!project) return null;

  const projectColor = project.color || T.domains.projects;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={project.name}
        color={projectColor}
        icon="projects"
        subtitle={`${stats.progress}% complete - ${stats.done}/${stats.total} tasks`}
        rightActions={
          <>
            <CommentButton
              contentType={ContentType.PROJECT}
              contentId={project.id}
              color={projectColor}
            />
            <ShareButton
              contentType={ContentType.PROJECT}
              contentId={project.id}
              color={projectColor}
            />
            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Funnel size={18} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <DotsThree size={22} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <View style={[styles.viewTabs, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        {(["Table", "Board", "Roadmap"] as ViewMode[]).map((view) => {
          const isActive = activeView === view;
          return (
            <TouchableOpacity
              key={view}
              style={[
                styles.viewTab,
                isActive && { borderBottomColor: projectColor, borderBottomWidth: 2 },
              ]}
              onPress={() => {
                if (view === "Roadmap") {
                  router.push({ pathname: "/projects/roadmap" as any, params: { projectId: id } });
                } else {
                  setActiveView(view);
                }
              }}
            >
              <Text style={[styles.viewTabText, { color: isActive ? projectColor : T.textDim }]}>
                {view}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeView === "Table" ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomPad }}
        >
          {columns.map((col) => {
            const colTasks = tasks
              .filter((t) => t.status === col.key && !t.parentId)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            if (colTasks.length === 0) return null;
            return (
              <View key={col.key}>
                <View
                  style={[
                    styles.listGroupHeader,
                    { backgroundColor: T.bg, borderBottomColor: T.border },
                  ]}
                >
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.listGroupTitle, { color: T.textBright }]}>{col.label}</Text>
                  <View style={[styles.colCount, { backgroundColor: T.surfaceHover }]}>
                    <Text style={[styles.colCountText, { color: T.textDim }]}>
                      {colTasks.length}
                    </Text>
                  </View>
                </View>
                {colTasks.map((task) => {
                  const isDone = !!task.completedAt;
                  const isBlocked = task.blockedByTaskIds.length > 0;
                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={[
                        styles.listRow,
                        { borderBottomColor: T.border, borderLeftColor: col.color },
                      ]}
                      onPress={() => router.push(`/projects/task/${task.id}` as any)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text
                          style={[
                            styles.listTaskTitle,
                            {
                              color: isDone ? T.textDim : T.textBright,
                              textDecorationLine: isDone ? "line-through" : "none",
                            },
                          ]}
                          numberOfLines={2}
                        >
                          {task.title}
                        </Text>
                        <View style={styles.listTaskMeta}>
                          {task.priority ? (
                            <PriorityBadge priority={task.priority} options={priorityOptions} />
                          ) : null}
                          {isBlocked && (
                            <View style={[styles.blockedBadge, { backgroundColor: "#ef444418" }]}>
                              <Warning size={9} color="#ef4444" weight="bold" />
                              <Text style={[styles.priorityText, { color: "#ef4444" }]}>
                                Blocked
                              </Text>
                            </View>
                          )}
                          {task.dueDate ? (
                            <Text style={[styles.listDueDate, { color: T.textDim }]}>
                              {task.dueDate}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {task.assigneeIds.length > 0 && (
                        <View style={[styles.assigneeCount, { backgroundColor: T.surfaceHover }]}>
                          <Text style={[styles.assigneeCountText, { color: T.textDim }]}>
                            {task.assigneeIds.length}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

          <TouchableOpacity
            style={[styles.listAddBtn, { borderColor: T.border }]}
            activeOpacity={0.7}
            onPress={() =>
              router.push({ pathname: "/projects/task/create" as any, params: { projectId: id } })
            }
          >
            <Plus size={15} color={T.textDim} weight="bold" />
            <Text style={[styles.addTaskText, { color: T.textDim }]}>Add task</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : activeView === "Board" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
        >
          {columns.map((col) => {
            const colTasks = tasks
              .filter((t) => t.status === col.key && !t.parentId)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <View
                key={col.key}
                style={[styles.column, { backgroundColor: T.surface, borderColor: T.border }]}
              >
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.colTitle, { color: T.textBright }]}>{col.label}</Text>
                  <View style={[styles.colCount, { backgroundColor: T.surfaceHover }]}>
                    <Text style={[styles.colCountText, { color: T.textDim }]}>
                      {colTasks.length}
                    </Text>
                  </View>
                </View>

                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    allTasks={tasks}
                    priorityOptions={priorityOptions}
                    statusColor={col.color}
                    onPress={() => router.push(`/projects/task/${task.id}` as any)}
                  />
                ))}

                <TouchableOpacity
                  style={[styles.addTaskBtn, { borderColor: T.border }]}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push({
                      pathname: "/projects/task/create" as any,
                      params: { projectId: id, status: col.key },
                    })
                  }
                >
                  <Plus size={14} color={T.textDim} weight="bold" />
                  <Text style={[styles.addTaskText, { color: T.textDim }]}>Add task</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={project.name}
        subtitle={`${stats.done}/${stats.total} tasks`}
        icon="projects"
        iconColor={projectColor}
        actions={[
          {
            icon: "edit-2",
            label: "Edit project",
            onPress: () =>
              router.push({ pathname: "/projects/create" as any, params: { projectId: id } }),
          },
          {
            icon: "trash-2",
            label: "Delete project",
            isDanger: true,
            onPress: () => {
              deleteProject.mutate(id, { onSuccess: () => router.back() });
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  viewTabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  viewTab: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: -1,
  },
  viewTabText: { fontSize: 14, fontFamily: FONT.medium },
  column: {
    width: 260,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  colHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 4 },
  colDot: { width: 7, height: 7, borderRadius: 4 },
  colTitle: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  colCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  colCountText: { fontSize: 11, fontFamily: FONT.medium },
  taskCard: {
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  taskTags: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  priorityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: { fontSize: 10, fontFamily: FONT.medium },
  blockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  taskTitle: { fontSize: 13, fontFamily: FONT.medium, lineHeight: 19 },
  taskFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  taskFooterLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dueDateRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  dueDateText: { fontSize: 11, fontFamily: FONT.regular },
  subtaskCount: { fontSize: 11, fontFamily: FONT.medium },
  assigneeCount: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  assigneeCountText: { fontSize: 10, fontFamily: FONT.semibold },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addTaskText: { fontSize: 13, fontFamily: FONT.regular },
  listGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listGroupTitle: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  listTaskTitle: { fontSize: 14, fontFamily: FONT.medium, lineHeight: 20 },
  listTaskMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  listDueDate: { fontSize: 12, fontFamily: FONT.regular },
  listAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
  },
});
