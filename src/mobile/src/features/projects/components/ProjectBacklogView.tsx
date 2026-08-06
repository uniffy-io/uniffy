import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Plus, X } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { useProjectSprints } from "@features/projects/useProjects";
import {
  useCreateSprint,
  useStartSprint,
  useCompleteSprint,
  useDeleteSprint,
  useMoveTasksToSprint,
} from "@features/projects/useProjectMutations";
import { DONE_STATUS_ID } from "@features/projects/projectsSerializer";
import { SprintCard } from "@features/projects/components/SprintCard";
import { BacklogTaskRow } from "@features/projects/components/BacklogTaskRow";
import { SprintCompleteSheet } from "@features/projects/components/SprintCompleteSheet";
import { SprintPickerSheet } from "@features/projects/components/SprintPickerSheet";
import type {
  SerializedProject,
  SerializedTask,
  PlainSelectOption,
} from "@features/projects/projectsSerializer";

export function ProjectBacklogView({
  project,
  tasks: allTasks,
  statusOptions,
  priorityOptions,
  accentColor,
  bottomPad,
  canEdit,
  onOpenTask,
}: {
  project: SerializedProject;
  tasks: SerializedTask[];
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  bottomPad: number;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const T = useTheme();
  const projectId = project.id;
  const sprintsQuery = useProjectSprints(projectId);

  const createSprint = useCreateSprint();
  const startSprint = useStartSprint();
  const completeSprint = useCompleteSprint();
  const deleteSprint = useDeleteSprint();
  const moveTasks = useMoveTasksToSprint();

  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [movingTask, setMovingTask] = useState<SerializedTask | null>(null);

  // Sprint planning is done in terms of top-level work; a subtask rides with
  // its parent rather than being planned on its own.
  const tasks = useMemo(() => allTasks.filter((t) => !t.parentId), [allTasks]);
  const sprints = useMemo(() => sprintsQuery.data ?? [], [sprintsQuery.data]);

  const activeSprint = sprints.find((s) => s.status === "active");
  const plannedSprints = useMemo(
    () => sprints.filter((s) => s.status === "planned").sort((a, b) => a.sortOrder - b.sortOrder),
    [sprints],
  );
  const closedSprints = useMemo(() => sprints.filter((s) => s.status === "closed"), [sprints]);
  const openSprintIds = useMemo(
    () => new Set(sprints.filter((s) => s.status !== "closed").map((s) => s.id)),
    [sprints],
  );
  // A task left behind in a closed sprint is unplanned work, so the backlog is
  // where it belongs on this screen.
  const backlogTasks = useMemo(
    () => tasks.filter((t) => !t.sprintId || !openSprintIds.has(t.sprintId)),
    [tasks, openSprintIds],
  );

  const tasksIn = (sprintId: string) => tasks.filter((t) => t.sprintId === sprintId);

  const completing = sprints.find((s) => s.id === completingId);
  const busy =
    createSprint.isPending ||
    startSprint.isPending ||
    completeSprint.isPending ||
    deleteSprint.isPending ||
    moveTasks.isPending;

  const resetForm = () => {
    setCreating(false);
    setName("");
    setGoal("");
    setStartDate(null);
    setEndDate(null);
  };

  const submitSprint = () => {
    if (!name.trim()) return;
    createSprint.mutate(
      {
        projectId,
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
      },
      { onSuccess: resetForm },
    );
  };

  /** Moves the unfinished work first, so the sprint only closes once it is empty. */
  const finishSprint = (sprintId: string, moves: { taskId: string; sprintId: string | null }[]) => {
    const close = () =>
      completeSprint.mutate({ projectId, sprintId }, { onSuccess: () => setCompletingId(null) });
    if (moves.length === 0) {
      close();
      return;
    }
    moveTasks.mutate({ projectId, moves }, { onSuccess: close });
  };

  if (sprintsQuery.isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={accentColor} />
      </View>
    );
  }

  const sprintCardProps = {
    projectSlug: project.slug,
    statusOptions,
    priorityOptions,
    accentColor,
    canEdit,
    canMoveTasks: canEdit,
    busy,
    onOpenTask,
    onMoveTask: setMovingTask,
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {activeSprint && (
          <SprintCard
            {...sprintCardProps}
            sprint={activeSprint}
            tasks={tasksIn(activeSprint.id)}
            onComplete={() => setCompletingId(activeSprint.id)}
            onDelete={() => deleteSprint.mutate({ projectId, sprintId: activeSprint.id })}
          />
        )}

        {plannedSprints.map((sprint) => (
          <SprintCard
            key={sprint.id}
            {...sprintCardProps}
            sprint={sprint}
            tasks={tasksIn(sprint.id)}
            onStart={() => startSprint.mutate({ projectId, sprintId: sprint.id })}
            onComplete={() => setCompletingId(sprint.id)}
            onDelete={() => deleteSprint.mutate({ projectId, sprintId: sprint.id })}
          />
        ))}

        {closedSprints.length > 0 && (
          <TouchableOpacity
            style={styles.closedToggle}
            onPress={() => setShowClosed(!showClosed)}
            activeOpacity={0.7}
          >
            <Text style={[styles.closedToggleText, { color: accentColor }]}>
              {showClosed ? "Hide" : "Show"} closed sprints ({closedSprints.length})
            </Text>
          </TouchableOpacity>
        )}

        {showClosed &&
          closedSprints.map((sprint) => (
            <SprintCard
              key={sprint.id}
              {...sprintCardProps}
              sprint={sprint}
              tasks={tasksIn(sprint.id)}
              onDelete={() => deleteSprint.mutate({ projectId, sprintId: sprint.id })}
            />
          ))}

        <View style={[styles.card, { backgroundColor: T.bg, borderColor: T.border }]}>
          <View style={[styles.cardHeader, { borderBottomColor: T.border }]}>
            <Text style={[styles.cardTitle, { color: T.textBright }]}>Backlog</Text>
            <View style={[styles.count, { backgroundColor: T.surfaceHover }]}>
              <Text style={[styles.countText, { color: T.textDim }]}>{backlogTasks.length}</Text>
            </View>
          </View>
          {backlogTasks.length === 0 ? (
            <Text style={[styles.empty, { color: T.textDim }]}>
              No tasks in the backlog. Create tasks, or move them here from a sprint.
            </Text>
          ) : (
            backlogTasks.map((task) => (
              <BacklogTaskRow
                key={task.id}
                task={task}
                projectSlug={project.slug}
                statusOptions={statusOptions}
                priorityOptions={priorityOptions}
                canMove={canEdit && openSprintIds.size > 0}
                onPress={() => onOpenTask(task.id)}
                onMove={() => setMovingTask(task)}
              />
            ))
          )}
        </View>

        {canEdit &&
          (creating ? (
            <View
              style={[styles.card, styles.form, { backgroundColor: T.bg, borderColor: T.border }]}
            >
              <View style={styles.formHeader}>
                <Text style={[styles.cardTitle, { color: T.textBright }]}>New sprint</Text>
                <TouchableOpacity
                  onPress={resetForm}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={16} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              </View>

              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: T.surface, borderColor: T.border, color: T.textBright },
                ]}
                value={name}
                onChangeText={setName}
                placeholder="Sprint name"
                placeholderTextColor={T.textDim}
                autoFocus
              />
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: T.surface, borderColor: T.border, color: T.textBright },
                ]}
                value={goal}
                onChangeText={setGoal}
                placeholder="Goal (optional)"
                placeholderTextColor={T.textDim}
              />
              <View style={styles.dateRow}>
                <View style={styles.dateCell}>
                  <Text style={[styles.label, { color: T.textDim }]}>Starts</Text>
                  <CalendarPicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="No start date"
                    accentColor={accentColor}
                  />
                </View>
                <View style={styles.dateCell}>
                  <Text style={[styles.label, { color: T.textDim }]}>Ends</Text>
                  <CalendarPicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="No end date"
                    accentColor={accentColor}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  { backgroundColor: accentColor, opacity: name.trim() ? 1 : 0.5 },
                ]}
                onPress={submitSprint}
                activeOpacity={0.8}
                disabled={!name.trim() || createSprint.isPending}
              >
                {createSprint.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Create sprint</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.addBtn, { borderColor: T.border }]}
              onPress={() => setCreating(true)}
              activeOpacity={0.7}
            >
              <Plus size={15} color={T.textDim} weight="bold" />
              <Text style={[styles.addText, { color: T.textDim }]}>Create sprint</Text>
            </TouchableOpacity>
          ))}
      </ScrollView>

      {completing && (
        <SprintCompleteSheet
          visible
          onClose={() => setCompletingId(null)}
          sprint={completing}
          incompleteTasks={tasksIn(completing.id).filter((t) => t.status !== DONE_STATUS_ID)}
          plannedSprints={plannedSprints.filter((s) => s.id !== completing.id)}
          projectSlug={project.slug}
          accentColor={accentColor}
          busy={moveTasks.isPending || completeSprint.isPending}
          onConfirm={(moves) => finishSprint(completing.id, moves)}
        />
      )}

      <SprintPickerSheet
        visible={!!movingTask}
        onClose={() => setMovingTask(null)}
        sprints={sprints.filter((s) => s.status !== "closed")}
        selectedId={movingTask?.sprintId}
        accentColor={accentColor}
        onSelect={(sprintId) => {
          if (movingTask) {
            moveTasks.mutate({ projectId, moves: [{ taskId: movingTask.id, sprintId }] });
          }
          setMovingTask(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 12, gap: 12 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: { fontSize: 15, fontFamily: FONT.semibold },
  count: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  countText: { fontSize: 11, fontFamily: FONT.medium },
  empty: {
    fontSize: 13,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  closedToggle: { alignSelf: "center", paddingVertical: 4 },
  closedToggleText: { fontSize: 13, fontFamily: FONT.semibold },
  form: { padding: 12, gap: 10 },
  formHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.4 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  dateRow: { flexDirection: "row", gap: 10 },
  dateCell: { flex: 1, gap: 5 },
  submitBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  submitText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addText: { fontSize: 13, fontFamily: FONT.regular },
});
