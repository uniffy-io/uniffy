import React, { useState } from "react";
import { View, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Plus } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { useTags, useTagMutations } from "@features/tags/useTags";

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
  const [query, setQuery] = useState("");
  const tags = useTags(query);
  const { create } = useTagMutations();

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
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Tags" busy={busy} />

      <SheetSearchBar value={query} onChangeText={setQuery} placeholder="Search or create a tag" />

      <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
        {trimmed.length > 0 && !exactMatch && (
          <SheetRow
            title={`Create \u201c${trimmed}\u201d`}
            leading={
              <View style={[styles.dot, { backgroundColor: T.accent }]}>
                <Plus size={12} color="#fff" weight="bold" />
              </View>
            }
            onPress={handleCreate}
          />
        )}
        {tags.data?.map((tag) => (
          <SheetRow
            key={tag.id}
            title={tag.name}
            leading={<View style={[styles.dot, { backgroundColor: tag.color }]} />}
            selected={selectedIds.includes(tag.id)}
            onPress={() => onToggle(tag.id)}
          />
        ))}
        {tags.isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={T.accent} />
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  dot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  loading: { padding: 16, alignItems: "center" },
});
