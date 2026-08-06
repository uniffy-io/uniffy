import React, { useMemo } from "react";
import { ScrollView } from "react-native";
import { Clock } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSection, SheetChip } from "@shared/components/SheetSection";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory } from "@shared/directory/useDirectory";
import { activeFilterCount, toggleValue, NO_TASK_FILTERS } from "@features/projects/taskFilters";
import type { TaskFilters } from "@features/projects/taskFilters";
import type {
  SerializedTask,
  SerializedTaskTag,
  PlainSelectOption,
} from "@features/projects/projectsSerializer";

/**
 * Assignee and tag facets come from the tasks on screen rather than the org
 * directory or the tag index - a filter that offers people and tags this
 * project never uses only ever yields an empty list.
 */
export function TaskFilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  tasks,
  statusOptions,
  priorityOptions,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  tasks: SerializedTask[];
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  accentColor?: string;
}) {
  const T = useTheme();
  const { byId } = useDirectory();
  const accent = accentColor || T.accent;

  const assigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) for (const id of task.assigneeIds) ids.add(id);
    return [...ids];
  }, [tasks]);

  const tags = useMemo(() => {
    const byTagId = new Map<string, SerializedTaskTag>();
    for (const task of tasks) for (const tag of task.tags) byTagId.set(tag.id, tag);
    return [...byTagId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const count = activeFilterCount(filters);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Filter tasks"
        accentColor={accent}
        actions={[
          ...(count > 0
            ? [
                {
                  label: "Clear all",
                  onPress: () => onChange(NO_TASK_FILTERS),
                  tone: "muted" as const,
                },
              ]
            : []),
          { label: "Done", onPress: onClose },
        ]}
      />

      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        <SheetSection title="Status">
          {statusOptions.map((opt) => (
            <SheetChip
              key={opt.id}
              label={opt.label}
              tint={opt.color}
              selected={filters.statusIds.includes(opt.id)}
              onPress={() =>
                onChange({ ...filters, statusIds: toggleValue(filters.statusIds, opt.id) })
              }
            />
          ))}
        </SheetSection>

        <SheetSection title="Priority">
          {priorityOptions.map((opt) => (
            <SheetChip
              key={opt.id}
              label={opt.label}
              tint={opt.color}
              selected={filters.priorityIds.includes(opt.id)}
              onPress={() =>
                onChange({ ...filters, priorityIds: toggleValue(filters.priorityIds, opt.id) })
              }
            />
          ))}
        </SheetSection>

        {assigneeIds.length > 0 && (
          <SheetSection title="Assignee">
            {assigneeIds.map((id) => {
              const subject = byId.get(id);
              return (
                <SheetChip
                  key={id}
                  label={subject?.name ?? "Unknown"}
                  tint={accent}
                  selected={filters.assigneeIds.includes(id)}
                  onPress={() =>
                    onChange({ ...filters, assigneeIds: toggleValue(filters.assigneeIds, id) })
                  }
                >
                  <Avatar name={subject?.name ?? "?"} avatarUrl={subject?.avatarUrl} size={18} />
                </SheetChip>
              );
            })}
          </SheetSection>
        )}

        {tags.length > 0 && (
          <SheetSection title="Tags">
            {tags.map((tag) => (
              <SheetChip
                key={tag.id}
                label={tag.name}
                tint={tag.color}
                selected={filters.tagIds.includes(tag.id)}
                onPress={() =>
                  onChange({ ...filters, tagIds: toggleValue(filters.tagIds, tag.id) })
                }
              />
            ))}
          </SheetSection>
        )}

        <SheetSection title="Due">
          <SheetChip
            label="Overdue only"
            tint={T.red}
            selected={filters.overdueOnly}
            onPress={() => onChange({ ...filters, overdueOnly: !filters.overdueOnly })}
          >
            <Clock size={13} color={filters.overdueOnly ? T.red : T.textDim} weight="duotone" />
          </SheetChip>
        </SheetSection>
      </ScrollView>
    </BottomSheet>
  );
}
