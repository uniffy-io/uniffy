import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Plus, X } from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useTags, useTagMutations } from "@/hooks/useTags";

const NEW_TAG_COLORS = ["#7C5CFC", "#F76707", "#2F9E44", "#1971C2", "#E8590C", "#C2255C"];

export function TagPickerSheet({
  visible,
  onClose,
  selectedIds,
  onToggle,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  busy?: boolean;
}) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const tags = useTags(query);
  const { create } = useTagMutations();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const trimmed = query.trim();
  const exactMatch = (tags.data ?? []).some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const handleCreate = () => {
    if (!trimmed) return;
    const color = NEW_TAG_COLORS[trimmed.length % NEW_TAG_COLORS.length];
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: (res) => {
          if (res.tag) onToggle(res.tag.id);
          setQuery("");
        },
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View />
      </TouchableOpacity>
      <View style={[styles.sheet, { backgroundColor: T.surface, paddingBottom: bottomPad + 8 }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: T.textBright }]}>Tags</Text>
          {busy && <ActivityIndicator size="small" color={T.domains.files} />}
        </View>

        <View style={[styles.searchBar, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          <TextInput
            style={[styles.searchInput, { color: T.textBright }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search or create a tag"
            placeholderTextColor={T.textDim}
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

        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {trimmed.length > 0 && !exactMatch && (
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: T.border }]}
              onPress={handleCreate}
              activeOpacity={0.7}
            >
              <View style={[styles.dot, { backgroundColor: T.accent }]}>
                <Plus size={12} color="#fff" weight="bold" />
              </View>
              <Text style={[styles.rowText, { color: T.textBright }]}>
                Create &ldquo;{trimmed}&rdquo;
              </Text>
            </TouchableOpacity>
          )}
          {tags.data?.map((tag) => {
            const isSel = selectedIds.includes(tag.id);
            return (
              <TouchableOpacity
                key={tag.id}
                style={[styles.row, { borderBottomColor: T.border }]}
                onPress={() => onToggle(tag.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.dot, { backgroundColor: tag.color }]} />
                <Text style={[styles.rowText, { color: T.textBright }]} numberOfLines={1}>
                  {tag.name}
                </Text>
                {isSel && <Check size={18} color={T.accent} weight="bold" />}
              </TouchableOpacity>
            );
          })}
          {tags.isLoading && (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={T.domains.files} />
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
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
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rowText: { fontSize: 15, fontFamily: FONT.medium, flex: 1 },
  loading: { padding: 16, alignItems: "center" },
});
