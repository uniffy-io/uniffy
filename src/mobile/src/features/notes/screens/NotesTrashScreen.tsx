import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { DotsThree, FolderSimple, Graph, NotePencil, Trash } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { useNotesTrash } from "@features/notes/useNotes";
import type { SerializedNote } from "@features/notes/noteSerializer";
import { formatRelativeSeconds } from "@shared/lib/dateFormatting";
import { useRestoreNote, useEmptyNotesTrash } from "@features/notes/useNoteMutations";

type SheetNote = { id: string; title: string } | null;

function TrashIcon({ note, T }: { note: SerializedNote; T: ThemeColors }) {
  if (note.nodeType === NodeType.FOLDER) {
    return <FolderSimple size={16} color={T.textDim} weight="fill" />;
  }
  if (note.nodeType === NodeType.CANVAS) {
    return <Graph size={16} color={T.textDim} weight="duotone" />;
  }
  return <NotePencil size={16} color={T.textDim} weight="fill" />;
}

export function NotesTrashScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const trash = useNotesTrash();
  const restoreNote = useRestoreNote();
  const emptyTrash = useEmptyNotesTrash();
  const [sheetNote, setSheetNote] = useState<SheetNote>(null);

  const notes = trash.data ?? [];
  const isEmpty = notes.length === 0;

  const confirmEmpty = () => {
    Alert.alert("Empty trash", "Permanently delete your trashed notes? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Empty trash", style: "destructive", onPress: () => emptyTrash.mutate() },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Trash"
        color={T.accent}
        icon="notes"
        onBack={() => router.back()}
        rightActions={
          <TouchableOpacity
            onPress={confirmEmpty}
            disabled={isEmpty || emptyTrash.isPending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ opacity: isEmpty ? 0.4 : 1 }}
          >
            <Trash size={19} color="#FA5252" weight="bold" />
          </TouchableOpacity>
        }
      />

      {trash.isLoading && !trash.data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: T.border }]}
              onPress={() => setSheetNote({ id: item.id, title: item.title })}
              activeOpacity={0.7}
            >
              <View style={[styles.rowIcon, { backgroundColor: T.surface }]}>
                <TrashIcon note={item} T={T} />
              </View>
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: T.textBright }]} numberOfLines={1}>
                  {item.title || "Untitled"}
                </Text>
                {item.deletedAt ? (
                  <Text style={[styles.rowMeta, { color: T.textDim }]}>
                    Deleted {formatRelativeSeconds(item.deletedAt.seconds)}
                  </Text>
                ) : null}
              </View>
              <DotsThree size={18} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
                <Trash size={32} color={T.accent} weight="duotone" />
              </View>
              <Text style={[styles.emptyTitle, { color: T.textBright }]}>Trash is empty</Text>
              <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
                Deleted notes show up here
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            isEmpty ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={trash.isFetching && !trash.isLoading}
              onRefresh={() => trash.refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        />
      )}

      <ActionSheet
        visible={!!sheetNote}
        onClose={() => setSheetNote(null)}
        title={sheetNote?.title ?? ""}
        icon="notes"
        iconColor={T.accent}
        actions={[
          {
            icon: "repeat",
            label: "Restore note",
            onPress: () => {
              if (sheetNote) restoreNote.mutate(sheetNote.id);
              setSheetNote(null);
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 24 },
  emptyContent: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontFamily: FONT.semibold },
  rowMeta: { fontSize: 12, fontFamily: FONT.regular },
  emptyState: { alignItems: "center", paddingTop: 80, gap: 12, paddingHorizontal: 32 },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold },
  emptySubtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center" },
});
