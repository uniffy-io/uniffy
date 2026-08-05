import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Check, UsersThree, X } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory } from "@shared/permissions/usePermissions";
import { FONT } from "@theme/typography";

const GROUP_TINT = "#8b5cf6";

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
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
        {busy && <ActivityIndicator size="small" color={accent} />}
      </View>

      <View style={[styles.searchBar, { backgroundColor: T.pageBg, borderColor: T.border }]}>
        <TextInput
          style={[styles.searchInput, { color: T.textBright }]}
          value={query}
          onChangeText={setQuery}
          placeholder={includeGroups ? "Search people and groups" : "Search people"}
          placeholderTextColor={T.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => setQuery("")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={15} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        {results.map((subject) => {
          const isSelected = selectedIds.includes(subject.id);
          return (
            <TouchableOpacity
              key={`${subject.kind}:${subject.id}`}
              style={[styles.row, { borderBottomColor: T.border }]}
              onPress={() => onToggle(subject.id)}
              activeOpacity={0.7}
            >
              {subject.kind === "GROUP" ? (
                <View style={[styles.groupAvatar, { backgroundColor: GROUP_TINT + "22" }]}>
                  <UsersThree size={16} color={GROUP_TINT} weight="fill" />
                </View>
              ) : (
                <Avatar name={subject.name} avatarUrl={subject.avatarUrl} size={32} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
                  {subject.name}
                </Text>
                <Text style={[styles.sub, { color: T.textDim }]} numberOfLines={1}>
                  {subject.kind === "GROUP"
                    ? `${subject.memberCount ?? 0} members`
                    : (subject.email ?? "")}
                </Text>
              </View>
              {isSelected && <Check size={18} color={accent} weight="bold" />}
            </TouchableOpacity>
          );
        })}
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 16, fontFamily: FONT.bold },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupAvatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 15, fontFamily: FONT.medium },
  sub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  loading: { padding: 16, alignItems: "center" },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
