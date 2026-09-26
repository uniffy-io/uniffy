import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { create } from "@bufbuild/protobuf";
import { SortAscending, SortDescending } from "phosphor-react-native";
import {
  FieldType,
  SortDirection,
  TaskPseudoField as Pseudo,
  TaskSortSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { TaskFieldRef, ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSection, SheetChip } from "@shared/components/SheetSection";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import {
  ASSIGNEE_FIELD_ID,
  DUE_DATE_FIELD_ID,
  PRIORITY_FIELD_ID,
  STATUS_FIELD_ID,
} from "@features/projects/projectsSerializer";
import type {
  SerializedFieldDefinition,
  SerializedViewLayout,
} from "@features/projects/projectsSerializer";
import {
  dimensionKey,
  dimensionOf,
  groupByFor,
  groupDimensions,
} from "@features/projects/taskGrouping";
import {
  fieldRef,
  fieldRefKey,
  isDescending,
  pseudoRef,
  withGroupBy,
  withSort,
} from "@features/projects/viewDefinition";

const TITLE_FIELD_ID = "field_title";
const START_DATE_FIELD_ID = "field_start_date";

const SORTABLE_CUSTOM_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.SINGLE_SELECT,
  FieldType.DATE,
  FieldType.PERSON,
]);

function sortFields(
  fields: readonly SerializedFieldDefinition[],
): { ref: TaskFieldRef; label: string }[] {
  const builtIn = [
    { ref: fieldRef(TITLE_FIELD_ID), label: "Title" },
    { ref: fieldRef(STATUS_FIELD_ID), label: "Status" },
    { ref: fieldRef(PRIORITY_FIELD_ID), label: "Priority" },
    { ref: fieldRef(ASSIGNEE_FIELD_ID), label: "Assignee" },
    { ref: fieldRef(DUE_DATE_FIELD_ID), label: "Due date" },
    { ref: fieldRef(START_DATE_FIELD_ID), label: "Start date" },
    { ref: pseudoRef(Pseudo.CREATED_AT), label: "Created" },
    { ref: pseudoRef(Pseudo.UPDATED_AT), label: "Updated" },
    { ref: pseudoRef(Pseudo.COMPLETED_AT), label: "Completed" },
    { ref: pseudoRef(Pseudo.ESTIMATED_MINUTES), label: "Estimate" },
    { ref: pseudoRef(Pseudo.NUMBER), label: "ID" },
  ];
  const custom = fields
    .filter((field) => !field.isSystem && SORTABLE_CUSTOM_TYPES.has(field.type))
    .map((field) => ({ ref: fieldRef(field.id), label: field.name }));
  return [...builtIn, ...custom];
}

/**
 * Grouping (table only) and the sort of the open view. The phone sorts by one field; picking one
 * replaces a multi-key sort built on the web, which the sheet says before it happens.
 */
export function TaskDisplaySheet({
  visible,
  onClose,
  layout,
  definition,
  onChange,
  fields,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  layout: SerializedViewLayout;
  definition: ViewDefinition;
  onChange: (definition: ViewDefinition) => void;
  fields: SerializedFieldDefinition[];
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const options = useMemo(() => sortFields(fields), [fields]);
  const dimensions = useMemo(() => groupDimensions(fields), [fields]);

  const primary = definition.sort[0];
  const primaryKey = fieldRefKey(primary?.field);
  const extraKeys = Math.max(0, definition.sort.length - 1);
  const descending = primary ? isDescending(primary.direction) : false;

  const groupBy = definition.groupBy;
  const current = dimensionOf(groupBy, fields);
  // A grouping the phone cannot draw leaves the table on status, and says so.
  const unsupportedGroup = !!groupBy && !current;
  const currentKey = current ? dimensionKey(current) : "status";

  const setSort = (ref: TaskFieldRef | null, direction: SortDirection) =>
    onChange(withSort(definition, ref ? [create(TaskSortSchema, { field: ref, direction })] : []));

  const setDirection = (direction: SortDirection) =>
    onChange(
      withSort(definition, [
        create(TaskSortSchema, { field: primary?.field, direction }),
        ...definition.sort.slice(1),
      ]),
    );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Display"
        accentColor={accent}
        actions={[{ label: "Done", onPress: onClose }]}
      />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {layout === "table" && (
          <>
            <SheetSection title="Group by">
              {dimensions.map(({ dimension, label }) => {
                const key = dimensionKey(dimension);
                return (
                  <SheetChip
                    key={key}
                    label={label}
                    selected={!unsupportedGroup && key === currentKey}
                    showCheck={false}
                    onPress={() => {
                      if (!unsupportedGroup && key === currentKey) return;
                      onChange(withGroupBy(definition, groupByFor(dimension, groupBy)));
                    }}
                  />
                );
              })}
            </SheetSection>
            {unsupportedGroup && (
              <Text style={[styles.note, { color: T.textDim }]}>
                This view is grouped on the web by a field the phone does not group by, so it is
                shown by status here.
              </Text>
            )}
            <SheetSection title="Groups">
              <SheetChip
                label="Hide empty groups"
                selected={!!groupBy?.hideEmpty}
                onPress={() => {
                  const next = groupByFor(current ?? { kind: "status" }, groupBy);
                  next.hideEmpty = !groupBy?.hideEmpty;
                  onChange(withGroupBy(definition, next));
                }}
              />
            </SheetSection>
          </>
        )}

        <SheetSection title="Sort by">
          <SheetChip
            label="Manual order"
            selected={!primary}
            showCheck={false}
            onPress={() => setSort(null, SortDirection.ASC)}
          />
          {options.map((option) => {
            const key = fieldRefKey(option.ref);
            return (
              <SheetChip
                key={key}
                label={option.label}
                selected={key === primaryKey}
                showCheck={false}
                onPress={() => setSort(option.ref, primary ? primary.direction : SortDirection.ASC)}
              />
            );
          })}
        </SheetSection>
        {extraKeys > 0 && (
          <Text style={[styles.note, { color: T.textDim }]}>
            {`Then ${extraKeys} more sort key${extraKeys === 1 ? "" : "s"} from the web. Picking a field here sorts by that field alone.`}
          </Text>
        )}

        {primary && (
          <SheetSection title="Direction">
            <SheetChip
              label="Ascending"
              selected={!descending}
              showCheck={false}
              onPress={() => setDirection(SortDirection.ASC)}
            >
              <SortAscending size={14} color={!descending ? accent : T.textDim} weight="bold" />
            </SheetChip>
            <SheetChip
              label="Descending"
              selected={descending}
              showCheck={false}
              onPress={() => setDirection(SortDirection.DESC)}
            >
              <SortDescending size={14} color={descending ? accent : T.textDim} weight="bold" />
            </SheetChip>
          </SheetSection>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 520 },
  note: {
    fontSize: 12,
    fontFamily: FONT.regular,
    paddingHorizontal: 16,
    marginTop: -6,
    marginBottom: 14,
  },
});
