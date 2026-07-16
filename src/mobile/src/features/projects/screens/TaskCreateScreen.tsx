import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { MentionTextInput } from "@shared/mentions/MentionTextInput";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProject, useTask } from "@features/projects/useProjects";
import { useCreateTask, useUpdateTask } from "@features/projects/useProjectMutations";
import { getStatusOptions, getPriorityOptions } from "@features/projects/projectsSerializer";

export function CreateTaskScreen() {
  const {
    projectId: projectIdParam,
    taskId,
    status: initialStatus,
  } = useLocalSearchParams<{ projectId?: string; taskId?: string; status?: string }>();
  const isEditing = !!taskId;
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const taskQuery = useTask(taskId);
  const task = taskQuery.data;
  const projectId = isEditing ? task?.projectId : projectIdParam;

  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const statusOptions = project ? getStatusOptions(project) : [];
  const priorityOptions = project ? getPriorityOptions(project) : [];
  const projectColor = project?.color || T.accent;

  const [title, setTitle] = useState("");
  const descriptionRef = useRef("");
  const [initialDescription, setInitialDescription] = useState<string | undefined>(undefined);
  const [selectedStatus, setSelectedStatus] = useState<string>(
    initialStatus ?? statusOptions[0]?.id ?? "",
  );
  const [selectedPriority, setSelectedPriority] = useState<string>("");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);

  // Default the status once the project's options load (create mode only).
  // Guarded so this render-time adjustment settles after one pass.
  if (!isEditing && statusOptions.length > 0 && !selectedStatus) {
    setSelectedStatus(initialStatus ?? statusOptions[0].id);
  }

  // Prefill editable fields once the task to edit loads.
  const [prefilled, setPrefilled] = useState(false);
  if (task && !prefilled) {
    setPrefilled(true);
    setTitle(task.title);
    setInitialDescription(task.description || undefined);
    setSelectedStatus(task.status ?? "");
    setSelectedPriority(task.priority ?? "");
    setStartDate(task.startDate);
    setDueDate(task.dueDate);
  }

  // The description is an uncontrolled ref; seed it once off the render path.
  const descSeededRef = useRef(false);
  useEffect(() => {
    if (task && !descSeededRef.current) {
      descSeededRef.current = true;
      descriptionRef.current = task.description ?? "";
    }
  }, [task]);

  const isSaving = createTask.isPending || updateTask.isPending;
  const canSave = title.trim().length > 0 && !isSaving && (isEditing ? !!taskId : !!projectId);

  function handleSave() {
    if (!canSave) return;
    if (isEditing && taskId) {
      updateTask.mutate(
        {
          taskId,
          title: title.trim(),
          description: descriptionRef.current.trim(),
          status: selectedStatus || undefined,
          priority: selectedPriority || undefined,
          startDate,
          dueDate,
        },
        { onSuccess: () => router.back() },
      );
    } else {
      createTask.mutate(
        {
          projectId: projectId!,
          title: title.trim(),
          description: descriptionRef.current.trim() || undefined,
          status: selectedStatus || undefined,
          priority: selectedPriority || undefined,
          startDate: startDate ?? undefined,
          dueDate: dueDate ?? undefined,
        },
        { onSuccess: () => router.back() },
      );
    }
  }

  if (projectQuery.isLoading || (isEditing && taskQuery.isLoading)) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={isEditing ? "Edit Task" : "New Task"}
        color={projectColor}
        icon="projects"
        subtitle={project?.name}
        rightActions={
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={projectColor} />
            ) : (
              <Text style={[styles.saveBtn, { color: canSave ? projectColor : T.textDim }]}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Title</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: T.surface, borderColor: T.border, color: T.textBright },
            ]}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={T.textDim}
            autoFocus={!isEditing}
          />
        </View>

        {statusOptions.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: T.textDim }]}>Status</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {statusOptions.map((opt) => {
                const isActive = selectedStatus === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.pill,
                      {
                        borderColor: isActive ? opt.color : T.border,
                        backgroundColor: isActive ? opt.color + "18" : T.surface,
                      },
                    ]}
                    onPress={() => setSelectedStatus(opt.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.pillDot, { backgroundColor: opt.color }]} />
                    <Text style={[styles.pillText, { color: isActive ? opt.color : T.textDim }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {priorityOptions.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: T.textDim }]}>Priority</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              <TouchableOpacity
                style={[
                  styles.pill,
                  {
                    borderColor: !selectedPriority ? T.accent : T.border,
                    backgroundColor: !selectedPriority ? T.accentSoft : T.surface,
                  },
                ]}
                onPress={() => setSelectedPriority("")}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.pillText, { color: !selectedPriority ? T.accent : T.textDim }]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {priorityOptions.map((opt) => {
                const isActive = selectedPriority === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.pill,
                      {
                        borderColor: isActive ? opt.color : T.border,
                        backgroundColor: isActive ? opt.color + "18" : T.surface,
                      },
                    ]}
                    onPress={() => setSelectedPriority(opt.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, { color: isActive ? opt.color : T.textDim }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Description</Text>
          <MentionTextInput
            style={[
              styles.input,
              styles.textArea,
              { backgroundColor: T.surface, borderColor: T.border, color: T.textBright },
            ]}
            initialContent={initialDescription}
            onCanonicalChange={(c) => {
              descriptionRef.current = c;
            }}
            placeholder="Optional description"
            placeholderTextColor={T.textDim}
            numberOfLines={4}
          />
        </View>

        <View style={styles.datesRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.label, { color: T.textDim }]}>Start date</Text>
            <CalendarPicker
              value={startDate}
              onChange={setStartDate}
              placeholder="No start date"
              accentColor={projectColor}
            />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.label, { color: T.textDim }]}>Due date</Text>
            <CalendarPicker
              value={dueDate}
              onChange={setDueDate}
              placeholder="No due date"
              accentColor={projectColor}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, gap: 20 },
  label: { fontSize: 12, fontFamily: FONT.semibold, letterSpacing: 0.5 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  textArea: { minHeight: 100 },
  saveBtn: { fontSize: 15, fontFamily: FONT.semibold },
  pillRow: { gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 13, fontFamily: FONT.medium },
  datesRow: { flexDirection: "row", gap: 12 },
});
