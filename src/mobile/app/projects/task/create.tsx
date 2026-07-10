import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { MentionTextInput } from "@/components/MentionTextInput";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { CalendarPicker } from "@/components/CalendarPicker";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useProject, useTask } from "@/hooks/useProjects";
import { useCreateTask, useUpdateTask } from "@/hooks/useProjectMutations";
import { getStatusOptions, getPriorityOptions } from "@/lib/projectsSerializer";

export default function CreateTaskScreen() {
  const {
    projectId: projectIdParam,
    taskId,
    status: initialStatus,
  } = useLocalSearchParams<{ projectId?: string; taskId?: string; status?: string }>();
  const isEditing = !!taskId;
  const T = useTheme();

  const taskQuery = useTask(taskId);
  const task = taskQuery.data;
  const projectId = isEditing ? task?.projectId : projectIdParam;

  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const statusOptions = project ? getStatusOptions(project) : [];
  const priorityOptions = project ? getPriorityOptions(project) : [];
  const projectColor = project?.color || T.domains.projects;

  const [title, setTitle] = useState("");
  const descriptionRef = useRef("");
  const [initialDescription, setInitialDescription] = useState<string | undefined>(undefined);
  const [selectedStatus, setSelectedStatus] = useState<string>(
    initialStatus ?? statusOptions[0]?.id ?? "",
  );
  const [selectedPriority, setSelectedPriority] = useState<string>("");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);

  // Update default status when creating and the project loads
  useEffect(() => {
    if (!isEditing && statusOptions.length > 0 && !selectedStatus) {
      setSelectedStatus(initialStatus ?? statusOptions[0].id);
    }
  }, [isEditing, statusOptions, initialStatus, selectedStatus]);

  // Prefill once the task to edit has loaded
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!task || prefilledRef.current) return;
    prefilledRef.current = true;
    setTitle(task.title);
    descriptionRef.current = task.description ?? "";
    setInitialDescription(task.description || undefined);
    setSelectedStatus(task.status ?? "");
    setSelectedPriority(task.priority ?? "");
    setStartDate(task.startDate);
    setDueDate(task.dueDate);
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
        <ActivityIndicator size="large" color={T.domains.projects} />
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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
