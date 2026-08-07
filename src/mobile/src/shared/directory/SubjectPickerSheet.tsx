import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { UsersThree } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { SheetRow } from "@shared/components/SheetRow";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory } from "@shared/directory/useDirectory";
import { FONT } from "@theme/typography";

/**
 * Multi-select over org members and groups. The directory is loaded once and
 * cached by `useDirectory`, so filtering is local - no request per keystroke.
 */
export function SubjectPickerSheet({
  visible,
  onClose,
  title,
  selectedIds,
  onToggle,
  includeGroups = false,
  accentColor,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  selectedIds: string[];
  onToggle: (subjectId: string) => void;
  includeGroups?: boolean;
  accentColor?: string;
  busy?: boolean;
}) {
  const T = useTheme();
  const [query, setQuery] = useState("");
  const { subjects, isLoading } = useDirectory();
  const accent = accentColor || T.accent;

  const results = useMemo(() => {
    const pool = includeGroups ? subjects : subjects.filter((s) => s.kind === "USER");
    const trimmed = query.trim().toLowerCase();
    const matches = trimmed
      ? pool.filter(
          (s) =>
            s.name.toLowerCase().includes(trimmed) ||
            (s.email ?? "").toLowerCase().includes(trimmed),
        )
      : pool;
    // Already-selected subjects float up so deselecting never means scrolling.
    return [...matches].sort((a, b) => {
      const aSel = selectedIds.includes(a.id) ? 0 : 1;
      const bSel = selectedIds.includes(b.id) ? 0 : 1;
      return aSel - bSel || a.name.localeCompare(b.name);
    });
  }, [subjects, includeGroups, query, selectedIds]);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title={title} busy={busy} accentColor={accent} />

      <SheetSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder={includeGroups ? "Search people and groups" : "Search people"}
        autoCapitalize="none"
      />

      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        {results.map((subject) => (
          <SheetRow
            key={`${subject.kind}:${subject.id}`}
            title={subject.name}
            subtitle={
              subject.kind === "GROUP"
                ? `${subject.memberCount ?? 0} members`
                : (subject.email ?? "")
            }
            leading={
              subject.kind === "GROUP" ? (
                <View style={[styles.groupAvatar, { backgroundColor: T.group + "22" }]}>
                  <UsersThree size={16} color={T.group} weight="fill" />
                </View>
              ) : (
                <Avatar name={subject.name} avatarUrl={subject.avatarUrl} size={32} />
              )
            }
            selected={selectedIds.includes(subject.id)}
            accentColor={accent}
            onPress={() => onToggle(subject.id)}
          />
        ))}
        {isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={accent} />
          </View>
        )}
        {!isLoading && results.length === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>No matches</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  groupAvatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: { padding: 16, alignItems: "center" },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
