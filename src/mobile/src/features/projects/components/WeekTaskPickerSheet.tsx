import React, { useState } from "react";
import { Text, ScrollView, StyleSheet, ActivityIndicator, View } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { SheetRow } from "@shared/components/SheetRow";
import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useTaskSearch } from "@features/projects/useMyTime";

const SEARCH_DEBOUNCE_MS = 250;

export interface PickedTask {
  id: string;
  title: string;
  /** Unknown for a search hit; the entry the server returns names it. */
  projectId: string | null;
  subtitle?: string;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const T = useTheme();
  return (
    <View>
      <Text style={[styles.group, { color: T.textDim }]}>{title}</Text>
      {children}
    </View>
  );
}

/** The week's tasks and the internal ones up front; anything else through search. */
export function WeekTaskPickerSheet({
  visible,
  onClose,
  weekTasks,
  internalTasks,
  onPick,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  weekTasks: PickedTask[];
  internalTasks: PickedTask[];
  onPick: (task: PickedTask) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const search = useTaskSearch(debounced);
  const searching = query.trim().length > 0;

  // The sheet resets its search on the way in so a reopened picker starts clean.
  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setQuery("");
  }
  if (!visible && open) setOpen(false);

  const choose = (task: PickedTask) => onPick(task);

  const row = (task: PickedTask) => (
    <SheetRow
      key={task.id}
      title={task.title}
      subtitle={task.subtitle}
      accentColor={accent}
      onPress={() => choose(task)}
    />
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Pick a task" accentColor={accent} />
      <SheetSearchBar value={query} onChangeText={setQuery} placeholder="Search tasks" />
      <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
        {searching ? (
          search.isLoading ? (
            <ActivityIndicator style={styles.spinner} color={accent} />
          ) : (search.data ?? []).length === 0 ? (
            <Text style={[styles.empty, { color: T.textDim }]}>No matching tasks</Text>
          ) : (
            (search.data ?? []).map((hit) => row({ ...hit, projectId: null }))
          )
        ) : (
          <>
            {weekTasks.length > 0 && <Group title="This week">{weekTasks.map(row)}</Group>}
            {internalTasks.length > 0 && <Group title="Internal">{internalTasks.map(row)}</Group>}
            {weekTasks.length === 0 && internalTasks.length === 0 && (
              <Text style={[styles.empty, { color: T.textDim }]}>
                Search for a task to log time on.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  group: {
    fontSize: 11,
    fontFamily: FONT.medium,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  spinner: { padding: 20 },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
