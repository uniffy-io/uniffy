import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Check, Clock } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory } from "@shared/permissions/usePermissions";
import { FONT } from "@theme/typography";
import { activeFilterCount, toggleValue, NO_TASK_FILTERS } from "@features/projects/taskFilters";
import type { TaskFilters } from "@features/projects/taskFilters";
import type {
  SerializedTask,
  SerializedTaskTag,
  PlainSelectOption,
} from "@features/projects/projectsSerializer";

function Chip({
  label,
  color,
  selected,
  onPress,
  children,
}: {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const T = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: selected ? color + "22" : T.pageBg,
          borderColor: selected ? color : T.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {children}
      <Text style={[styles.chipText, { color: selected ? color : T.text }]} numberOfLines={1}>
        {label}
      </Text>
      {selected && <Check size={12} color={color} weight="bold" />}
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const T = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: T.textDim }]}>{title}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

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
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>Filter tasks</Text>
        <View style={styles.headerActions}>
          {count > 0 && (
            <TouchableOpacity
              onPress={() => onChange(NO_TASK_FILTERS)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.clear, { color: T.textDim }]}>Clear all</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.done, { color: accent }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        <Section title="Status">
          {statusOptions.map((opt) => (
            <Chip
              key={opt.id}
              label={opt.label}
              color={opt.color}
              selected={filters.statusIds.includes(opt.id)}
              onPress={() =>
                onChange({ ...filters, statusIds: toggleValue(filters.statusIds, opt.id) })
              }
            />
          ))}
        </Section>

        <Section title="Priority">
          {priorityOptions.map((opt) => (
            <Chip
              key={opt.id}
              label={opt.label}
              color={opt.color}
              selected={filters.priorityIds.includes(opt.id)}
              onPress={() =>
                onChange({ ...filters, priorityIds: toggleValue(filters.priorityIds, opt.id) })
              }
            />
          ))}
        </Section>

        {assigneeIds.length > 0 && (
          <Section title="Assignee">
            {assigneeIds.map((id) => {
              const subject = byId.get(id);
              return (
                <Chip
                  key={id}
                  label={subject?.name ?? "Unknown"}
                  color={accent}
                  selected={filters.assigneeIds.includes(id)}
                  onPress={() =>
                    onChange({ ...filters, assigneeIds: toggleValue(filters.assigneeIds, id) })
                  }
                >
                  <Avatar name={subject?.name ?? "?"} avatarUrl={subject?.avatarUrl} size={18} />
                </Chip>
              );
            })}
          </Section>
        )}

        {tags.length > 0 && (
          <Section title="Tags">
            {tags.map((tag) => (
              <Chip
                key={tag.id}
                label={tag.name}
                color={tag.color}
                selected={filters.tagIds.includes(tag.id)}
                onPress={() =>
                  onChange({ ...filters, tagIds: toggleValue(filters.tagIds, tag.id) })
                }
              />
            ))}
          </Section>
        )}

        <Section title="Due">
          <Chip
            label="Overdue only"
            color={T.red}
            selected={filters.overdueOnly}
            onPress={() => onChange({ ...filters, overdueOnly: !filters.overdueOnly })}
          >
            <Clock size={13} color={filters.overdueOnly ? T.red : T.textDim} weight="duotone" />
          </Chip>
        </Section>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  title: { fontSize: 16, fontFamily: FONT.bold },
  clear: { fontSize: 14, fontFamily: FONT.regular },
  done: { fontSize: 15, fontFamily: FONT.semibold },
  section: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  chipText: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1 },
});
