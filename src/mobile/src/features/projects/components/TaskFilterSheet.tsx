import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Clock, Diamond, Globe, Lightning, User, UserMinus } from "phosphor-react-native";
import type { TaskFilterGroup } from "@uniffy/proto/projects/v1/projects_pb";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSection, SheetChip } from "@shared/components/SheetSection";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory } from "@shared/directory/useDirectory";
import { useAuth } from "@core/providers/AuthContext";
import { FONT } from "@theme/typography";
import { TASK_TYPES } from "@features/projects/taskTypes";
import {
  activeFacetCount,
  applyFacets,
  clearAdvanced,
  readFacets,
  toggleFlag,
  toggleId,
} from "@features/projects/viewFacets";
import type { DuePreset, IdChoice, IdFacet, TaskFacets } from "@features/projects/viewFacets";
import type {
  PlainSelectOption,
  SerializedSprint,
  SerializedTask,
  SerializedTaskTag,
} from "@features/projects/projectsSerializer";

const DUE_PRESETS: { value: DuePreset; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This week" },
  { value: "next7Days", label: "Next 7 days" },
  { value: "none", label: "No date" },
];

/**
 * Edits the open view's filter. People, tags and epics come from the project's tasks rather than
 * the org directory or the tag index - offering ones this project never uses only ever yields an
 * empty list. Conditions built on the web that the sheet cannot show stay applied and are
 * summarized in one chip that can clear them.
 */
export function TaskFilterSheet({
  visible,
  onClose,
  filter,
  onChange,
  tasks,
  statusOptions,
  priorityOptions,
  sprints,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  filter: TaskFilterGroup | undefined;
  onChange: (filter: TaskFilterGroup | undefined) => void;
  /** Every task of the project, not just the filtered ones. */
  tasks: SerializedTask[];
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  sprints: SerializedSprint[];
  accentColor?: string;
}) {
  const T = useTheme();
  const { byId } = useDirectory();
  const { user } = useAuth();
  const accent = accentColor || T.accent;
  const { facets, advancedCount } = useMemo(() => readFacets(filter), [filter]);

  const people = useMemo(() => {
    const assignees = new Set<string>();
    const creators = new Set<string>();
    for (const task of tasks) {
      for (const id of task.assigneeIds) if (id !== user?.id) assignees.add(id);
      if (task.ownerId && task.ownerId !== user?.id) creators.add(task.ownerId);
    }
    const byName = (a: string, b: string) =>
      (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "");
    return { assignees: [...assignees].sort(byName), creators: [...creators].sort(byName) };
  }, [tasks, user?.id, byId]);

  const tags = useMemo(() => {
    const byTagId = new Map<string, SerializedTaskTag>();
    for (const task of tasks) for (const tag of task.tags) byTagId.set(tag.id, tag);
    return [...byTagId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const epics = useMemo(
    () =>
      tasks
        .filter((task) => task.taskType === "epic")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [tasks],
  );

  const openSprints = useMemo(
    () =>
      sprints
        .filter((sprint) => sprint.status !== "closed" || facets.ids.sprint.ids.includes(sprint.id))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [sprints, facets.ids.sprint.ids],
  );

  const write = (next: TaskFacets) => onChange(applyFacets(filter, next));
  const setChoice = (facet: IdFacet, choice: IdChoice) =>
    write({ ...facets, ids: { ...facets.ids, [facet]: choice } });
  const toggle = (facet: IdFacet, id: string) => setChoice(facet, toggleId(facets.ids[facet], id));
  const flag = (facet: IdFacet, name: "me" | "empty" | "active") =>
    setChoice(facet, toggleFlag(facets.ids[facet], name));

  const count = activeFacetCount(facets) + advancedCount;

  const personChip = (facet: IdFacet, id: string) => {
    const subject = byId.get(id);
    return (
      <SheetChip
        key={id}
        label={subject?.name ?? "Unknown"}
        tint={accent}
        selected={facets.ids[facet].ids.includes(id)}
        onPress={() => toggle(facet, id)}
      >
        <Avatar name={subject?.name ?? "?"} avatarUrl={subject?.avatarUrl} size={18} />
      </SheetChip>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Filter tasks"
        accentColor={accent}
        actions={[
          ...(count > 0
            ? [{ label: "Clear all", onPress: () => onChange(undefined), tone: "muted" as const }]
            : []),
          { label: "Done", onPress: onClose },
        ]}
      />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {advancedCount > 0 && (
          <View style={[styles.advanced, { backgroundColor: T.surface, borderColor: T.border }]}>
            <Globe size={16} color={T.textDim} weight="duotone" />
            <Text style={[styles.advancedText, { color: T.text }]}>
              {advancedCount === 1
                ? "1 advanced condition from the web"
                : `${advancedCount} advanced conditions from the web`}
            </Text>
            <TouchableOpacity
              onPress={() => onChange(clearAdvanced(filter))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.advancedClear, { color: accent }]}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}

        <SheetSection title="Status">
          {statusOptions.map((opt) => (
            <SheetChip
              key={opt.id}
              label={opt.label}
              tint={opt.color}
              selected={facets.ids.status.ids.includes(opt.id)}
              onPress={() => toggle("status", opt.id)}
            />
          ))}
        </SheetSection>

        <SheetSection title="Priority">
          {priorityOptions.map((opt) => (
            <SheetChip
              key={opt.id}
              label={opt.label}
              tint={opt.color}
              selected={facets.ids.priority.ids.includes(opt.id)}
              onPress={() => toggle("priority", opt.id)}
            />
          ))}
        </SheetSection>

        <SheetSection title="Assignee">
          <SheetChip
            label="Me"
            tint={accent}
            selected={facets.ids.assignee.me}
            onPress={() => flag("assignee", "me")}
          >
            <User size={14} color={facets.ids.assignee.me ? accent : T.textDim} weight="bold" />
          </SheetChip>
          <SheetChip
            label="Unassigned"
            tint={accent}
            selected={facets.ids.assignee.empty}
            onPress={() => flag("assignee", "empty")}
          >
            <UserMinus
              size={14}
              color={facets.ids.assignee.empty ? accent : T.textDim}
              weight="bold"
            />
          </SheetChip>
          {people.assignees.map((id) => personChip("assignee", id))}
        </SheetSection>

        <SheetSection title="Creator">
          <SheetChip
            label="Me"
            tint={accent}
            selected={facets.ids.creator.me}
            onPress={() => flag("creator", "me")}
          >
            <User size={14} color={facets.ids.creator.me ? accent : T.textDim} weight="bold" />
          </SheetChip>
          {people.creators.map((id) => personChip("creator", id))}
        </SheetSection>

        {tags.length > 0 && (
          <SheetSection title="Tags">
            {tags.map((tag) => (
              <SheetChip
                key={tag.id}
                label={tag.name}
                tint={tag.color}
                selected={facets.ids.tags.ids.includes(tag.id)}
                onPress={() => toggle("tags", tag.id)}
              />
            ))}
          </SheetSection>
        )}

        <SheetSection title="Type">
          {TASK_TYPES.map((type) => {
            const selected = facets.ids.taskType.ids.includes(type.value);
            return (
              <SheetChip
                key={type.value}
                label={type.label}
                selected={selected}
                onPress={() => toggle("taskType", type.value)}
              >
                <type.Icon size={14} color={selected ? accent : T.textDim} weight="duotone" />
              </SheetChip>
            );
          })}
        </SheetSection>

        <SheetSection title="Sprint">
          <SheetChip
            label="Active sprint"
            tint={T.green}
            selected={facets.ids.sprint.active}
            onPress={() => flag("sprint", "active")}
          />
          <SheetChip
            label="Backlog"
            selected={facets.ids.sprint.empty}
            onPress={() => flag("sprint", "empty")}
          />
          {openSprints.map((sprint) => (
            <SheetChip
              key={sprint.id}
              label={sprint.name}
              selected={facets.ids.sprint.ids.includes(sprint.id)}
              onPress={() => toggle("sprint", sprint.id)}
            />
          ))}
        </SheetSection>

        <SheetSection title="Due">
          {DUE_PRESETS.map((preset) => {
            const selected = facets.due === preset.value;
            const tint = preset.value === "overdue" ? T.red : accent;
            return (
              <SheetChip
                key={preset.value}
                label={preset.label}
                tint={tint}
                selected={selected}
                showCheck={false}
                onPress={() => write({ ...facets, due: selected ? null : preset.value })}
              >
                {preset.value === "overdue" && (
                  <Clock size={13} color={selected ? T.red : T.textDim} weight="duotone" />
                )}
              </SheetChip>
            );
          })}
        </SheetSection>

        <SheetSection title="Milestone">
          <SheetChip
            label="Milestones only"
            selected={facets.milestone}
            onPress={() => write({ ...facets, milestone: !facets.milestone })}
          >
            <Diamond size={13} color={facets.milestone ? accent : T.textDim} weight="duotone" />
          </SheetChip>
        </SheetSection>

        {epics.length > 0 && (
          <SheetSection title="In epic">
            {epics.map((epic) => {
              const selected = facets.ids.epic.ids.includes(epic.id);
              return (
                <SheetChip
                  key={epic.id}
                  label={epic.title}
                  selected={selected}
                  onPress={() => toggle("epic", epic.id)}
                >
                  <Lightning size={13} color={selected ? accent : T.textDim} weight="duotone" />
                </SheetChip>
              );
            })}
          </SheetSection>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 520 },
  advanced: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  advancedText: { flex: 1, fontSize: 13, fontFamily: FONT.medium },
  advancedClear: { fontSize: 13, fontFamily: FONT.semibold },
});
