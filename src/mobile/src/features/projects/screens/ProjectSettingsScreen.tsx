import React, { useMemo, useState } from "react";
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
  ArrowUp,
  ArrowDown,
  PencilSimple,
  Trash,
  Plus,
  CaretRight,
  Lock,
  Info,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { ShareSheet } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { roleCanManage } from "@shared/permissions/contentRoles";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT, STATUS_PALETTE } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProject, useProjectTasks } from "@features/projects/useProjects";
import {
  useUpdateField,
  useBulkUpdateTasks,
  useDeleteProject,
} from "@features/projects/useProjectMutations";
import { buildFieldConfigJson, STATUS_FIELD_ID } from "@features/projects/projectsSerializer";
import { isRequiredStatusOption, statusIdForSemantic } from "@features/projects/statusSemantics";
import { StatusEditorSheet } from "@features/projects/components/StatusEditorSheet";
import { OptionPickerSheet } from "@features/projects/components/OptionPickerSheet";
import type { PlainSelectOption } from "@features/projects/projectsSerializer";

type EditTarget = { mode: "add" } | { mode: "edit"; option: PlainSelectOption } | null;

function newStatusId(): string {
  return `status_${Math.random().toString(36).slice(2, 10)}`;
}

export function ProjectSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();

  const projectQuery = useProject(id);
  const tasksQuery = useProjectTasks(id);
  const updateField = useUpdateField();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const deleteProject = useDeleteProject();

  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [migrateFrom, setMigrateFrom] = useState<PlainSelectOption | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const project = projectQuery.data;
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const statusField = project?.fieldDefinitions.find((f) => f.id === STATUS_FIELD_ID);

  // The editor shows what the server actually stores. `getStatusOptions` would
  // substitute built-in defaults for an empty list, and saving those would
  // write statuses the project never had.
  const statuses = useMemo(
    () => [...(statusField?.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [statusField],
  );
  const missingDoneStatus =
    statuses.length > 0 && statusIdForSemantic(statuses, "completed") === null;
  const canManage = project ? roleCanManage(project.userRole) : false;

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const taskCountByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    return counts;
  }, [tasks]);

  // sortOrder is renumbered from the array position on every write, so the list
  // order on screen is always what the board and the pickers will use.
  const persist = (options: PlainSelectOption[]) => {
    if (!statusField || !project) return;
    const renumbered = options.map((option, index) => ({ ...option, sortOrder: index }));
    updateField.mutate({
      projectId: project.id,
      fieldId: STATUS_FIELD_ID,
      configJson: buildFieldConfigJson(statusField, renumbered),
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= statuses.length) return;
    const reordered = [...statuses];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    persist(reordered);
  };

  const saveStatus = (label: string, color: string) => {
    if (!editTarget) return;
    if (editTarget.mode === "add") {
      persist([...statuses, { id: newStatusId(), label, color, sortOrder: statuses.length }]);
    } else {
      persist(statuses.map((s) => (s.id === editTarget.option.id ? { ...s, label, color } : s)));
    }
  };

  const removeStatus = (option: PlainSelectOption) => {
    persist(statuses.filter((s) => s.id !== option.id));
  };

  const requestDelete = (option: PlainSelectOption) => {
    const inUse = taskCountByStatus.get(option.id) ?? 0;
    if (inUse > 0) {
      // Dropping the option while tasks still reference it would strand them in
      // a column no view renders, so the move happens first.
      setMigrateFrom(option);
      return;
    }
    confirmDestructive({
      title: "Delete status",
      message: `"${option.label}" will be removed from this project.`,
      onConfirm: () => removeStatus(option),
    });
  };

  const migrateAndDelete = (targetId: string) => {
    if (!migrateFrom || !project) return;
    const doomed = migrateFrom;
    const taskIds = tasks.filter((t) => t.status === doomed.id).map((t) => t.id);
    setMigrateFrom(null);
    bulkUpdateTasks.mutate(
      { projectId: project.id, taskIds, status: targetId },
      { onSuccess: () => removeStatus(doomed) },
    );
  };

  if (projectQuery.isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  if (!project) {
    return (
      <ScreenError
        title="Project settings"
        icon="projects"
        color={T.accent}
        onRetry={() => projectQuery.refetch()}
      />
    );
  }

  const projectColor = project.color || T.accent;
  const busy = updateField.isPending || bulkUpdateTasks.isPending;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Project settings"
        subtitle={project.name}
        color={projectColor}
        icon="projects"
        rightActions={busy ? <ActivityIndicator size="small" color={T.accent} /> : undefined}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
      >
        {!canManage && (
          <View style={[styles.notice, { backgroundColor: T.surface, borderColor: T.border }]}>
            <Lock size={15} color={T.textDim} weight="fill" />
            <Text style={[styles.noticeText, { color: T.textDim }]}>
              You need admin access on this project to change its settings.
            </Text>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text style={[styles.sectionTitle, { color: T.textDim }]}>Statuses</Text>
          <Text style={[styles.sectionHint, { color: T.textDim }]}>
            Order here controls the board columns and every status picker.
          </Text>

          {missingDoneStatus && (
            <View style={[styles.notice, { backgroundColor: T.red + "14", borderColor: T.red }]}>
              <Info size={15} color={T.red} weight="fill" />
              <Text style={[styles.noticeText, { color: T.red }]}>
                No status in this project marks work as completed, so nothing can be finished and
                status changes cannot be saved. An administrator has to repair the status list.
              </Text>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            {!statusField && (
              <Text style={[styles.emptyText, { color: T.textDim }]}>
                This project has no status field, so there is nothing to edit here. It has to be
                restored on the web app before statuses can be added.
              </Text>
            )}
            {statusField && statuses.length === 0 && (
              <Text style={[styles.emptyText, { color: T.textDim }]}>
                This project has no statuses defined yet.
              </Text>
            )}
            {statuses.map((option, index) => {
              const isProtected = isRequiredStatusOption(option);
              const inUse = taskCountByStatus.get(option.id) ?? 0;
              return (
                <View
                  key={option.id}
                  style={[
                    styles.statusRow,
                    index < statuses.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: T.border,
                    },
                  ]}
                >
                  <View style={[styles.statusDot, { backgroundColor: option.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusLabel, { color: T.textBright }]} numberOfLines={1}>
                      {option.label}
                    </Text>
                    <Text style={[styles.statusMeta, { color: T.textDim }]}>
                      {inUse} task{inUse === 1 ? "" : "s"}
                    </Text>
                  </View>

                  {canManage && (
                    <View style={styles.rowActions}>
                      <TouchableOpacity
                        onPress={() => move(index, -1)}
                        disabled={index === 0}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <ArrowUp
                          size={16}
                          color={index === 0 ? T.border : T.textDim}
                          weight="bold"
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => move(index, 1)}
                        disabled={index === statuses.length - 1}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <ArrowDown
                          size={16}
                          color={index === statuses.length - 1 ? T.border : T.textDim}
                          weight="bold"
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setEditTarget({ mode: "edit", option })}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <PencilSimple size={16} color={T.textDim} weight="bold" />
                      </TouchableOpacity>
                      {isProtected ? (
                        <Lock size={16} color={T.border} weight="fill" />
                      ) : (
                        <TouchableOpacity
                          onPress={() => requestDelete(option)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Trash size={16} color={T.red} weight="bold" />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {canManage && statusField && (
              <TouchableOpacity
                style={[styles.addRow, { borderColor: T.border }]}
                onPress={() => setEditTarget({ mode: "add" })}
                activeOpacity={0.7}
              >
                <Plus size={15} color={T.textDim} weight="bold" />
                <Text style={[styles.addText, { color: T.textDim }]}>Add status</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.hintRow}>
            <Info size={13} color={T.textDim} weight="duotone" />
            <Text style={[styles.sectionHint, { color: T.textDim, flex: 1 }]}>
              Locked statuses mark to do, in progress and completed work. They can be renamed,
              recoloured and reordered but not deleted - task completion, recurring tasks and
              blocker checks rely on them.
            </Text>
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[styles.sectionTitle, { color: T.textDim }]}>General</Text>
          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            <TouchableOpacity
              style={[
                styles.linkRow,
                { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
              ]}
              onPress={() =>
                router.push({ pathname: "/projects/create" as any, params: { projectId: id } })
              }
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkLabel, { color: T.textBright }]}>Name and appearance</Text>
                <Text style={[styles.linkSub, { color: T.textDim }]} numberOfLines={1}>
                  {project.name}
                </Text>
              </View>
              <CaretRight size={16} color={T.textDim} weight="bold" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => setShareOpen(true)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkLabel, { color: T.textBright }]}>Members and access</Text>
                <Text style={[styles.linkSub, { color: T.textDim }]}>
                  {project.memberCount} member{project.memberCount === 1 ? "" : "s"} -{" "}
                  {project.visibility === "ORGANIZATION" ? "Organization" : "Private"}
                </Text>
              </View>
              <CaretRight size={16} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          </View>
        </View>

        {canManage && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionTitle, { color: T.red }]}>Danger zone</Text>
            <TouchableOpacity
              style={[styles.dangerBtn, { borderColor: T.red }]}
              activeOpacity={0.7}
              onPress={() =>
                confirmDestructive({
                  title: "Delete project",
                  message: `"${project.name}" and its ${project.taskCount} task${project.taskCount === 1 ? "" : "s"} will be moved to the trash.`,
                  onConfirm: () =>
                    deleteProject.mutate(project.id, {
                      onSuccess: () => router.dismissAll(),
                    }),
                })
              }
            >
              <Trash size={15} color={T.red} weight="bold" />
              <Text style={[styles.dangerText, { color: T.red }]}>Delete project</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <StatusEditorSheet
        visible={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget?.mode === "edit" ? "Edit status" : "New status"}
        initialLabel={editTarget?.mode === "edit" ? editTarget.option.label : ""}
        initialColor={editTarget?.mode === "edit" ? editTarget.option.color : STATUS_PALETTE[0]}
        onSave={saveStatus}
      />

      <OptionPickerSheet
        visible={!!migrateFrom}
        onClose={() => setMigrateFrom(null)}
        title={`Move ${taskCountByStatus.get(migrateFrom?.id ?? "") ?? 0} task(s) to`}
        options={statuses.filter((s) => s.id !== migrateFrom?.id)}
        selectedId={undefined}
        onSelect={migrateAndDelete}
        accentColor={T.accent}
      />

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contentType={ContentType.PROJECT}
        contentId={project.id}
        color={T.accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center" },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { flex: 1, fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sectionHint: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17 },
  hintRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontSize: 15, fontFamily: FONT.medium },
  statusMeta: { fontSize: 11, fontFamily: FONT.regular, marginTop: 1 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addText: { fontSize: 14, fontFamily: FONT.regular },
  emptyText: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center", padding: 18 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  linkLabel: { fontSize: 15, fontFamily: FONT.medium },
  linkSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dangerText: { fontSize: 14, fontFamily: FONT.semibold },
});
