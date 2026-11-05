import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { UsersThree } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { SheetRow } from "@shared/components/SheetRow";
import { SheetSectionLabel } from "@shared/components/SheetSection";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory, type DirectorySubject } from "@shared/directory/useDirectory";
import { orderPickerRows, type PickerPinnedRow } from "@shared/directory/pickerRows";
import { usePeoplePicker } from "@shared/directory/usePeoplePicker";
import { FONT } from "@theme/typography";

export type { PickerPinnedRow } from "@shared/directory/pickerRows";

/**
 * Multi-select over org members (and groups). Before typing it lists the caller's ranked
 * colleagues; one character or more searches the whole organization on the server.
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
  pinned = [],
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  selectedIds: string[];
  onToggle: (subjectId: string) => void;
  includeGroups?: boolean;
  accentColor?: string;
  busy?: boolean;
  /** Action rows above the list, such as "Assign to me" or "Unassigned". */
  pinned?: PickerPinnedRow[];
}) {
  const T = useTheme();
  const [query, setQuery] = useState("");
  // People picked from a search may sit beyond the cached directory page; remember them.
  const [picked, setPicked] = useState<Map<string, DirectorySubject>>(() => new Map());
  const { byId } = useDirectory();
  const { results, isLoading, searching, recordPick } = usePeoplePicker({
    query,
    includeGroups,
    enabled: visible,
  });
  const accent = accentColor || T.accent;

  const rows = orderPickerRows({
    selectedIds,
    resolveSelected: (id) => picked.get(id) ?? byId.get(id),
    results,
    pinned,
    searching,
  });

  const handlePress = (subject: DirectorySubject) => {
    if (!selectedIds.includes(subject.id)) {
      setPicked((prev) => new Map(prev).set(subject.id, subject));
      if (subject.kind === "USER") recordPick(subject.id);
    }
    onToggle(subject.id);
  };

  const handleClose = () => {
    setQuery("");
    onClose();
  };

  const renderSubject = (subject: DirectorySubject) => (
    <SheetRow
      key={`${subject.kind}:${subject.id}`}
      title={subject.name}
      subtitle={
        subject.kind === "GROUP" ? `${subject.memberCount ?? 0} members` : (subject.email ?? "")
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
      onPress={() => handlePress(subject)}
    />
  );

  const showPinned = !searching && query.trim() === "" && pinned.length > 0;
  const empty = !isLoading && rows.selected.length === 0 && rows.rest.length === 0;

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      <SheetHeader title={title} busy={busy} accentColor={accent} />

      <SheetSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder={includeGroups ? "Search people and groups" : "Search people"}
        autoCapitalize="none"
      />

      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        {showPinned &&
          pinned.map((row) => (
            <SheetRow
              key={`pinned:${row.id}`}
              title={row.label}
              leading={row.leading}
              selected={row.selected}
              accentColor={accent}
              onPress={row.onPress}
            />
          ))}
        {rows.selected.map(renderSubject)}
        {!searching && rows.rest.length > 0 && (
          <SheetSectionLabel title="Suggested" style={styles.sectionTitle} />
        )}
        {rows.rest.map(renderSubject)}
        {isLoading && rows.rest.length === 0 && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={accent} />
          </View>
        )}
        {empty && searching && <Text style={[styles.empty, { color: T.textDim }]}>No matches</Text>}
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
  sectionTitle: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  loading: { padding: 16, alignItems: "center" },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
