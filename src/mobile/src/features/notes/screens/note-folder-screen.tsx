import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { DotsThree, NotePencil, Plus, FolderSimple, CaretRight } from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useDeleteNote } from "@features/notes/useNoteMutations";
import { useNotesTree } from "@features/notes/useNotesTree";
import type { TreeNode } from "@features/notes/useNotesTree";

type ListItem = { kind: "folder"; node: TreeNode } | { kind: "note"; node: TreeNode };

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export default function NotesFolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const notesTree = useNotesTree();
  const deleteNote = useDeleteNote();
  const [sheetNote, setSheetNote] = useState<{ id: string; title: string } | null>(null);

  const { folderTitle, items } = useMemo(() => {
    const sections = notesTree.data ?? [];
    const allNodes: TreeNode[] = [];
    for (const s of sections) allNodes.push(...s.nodes);

    const folder = findNode(allNodes, id);
    if (!folder) return { folderTitle: "Folder", items: [] as ListItem[] };

    const children = folder.children ?? [];
    const subfolders = children.filter((n) => n.type === "folder");
    const notes = [...children.filter((n) => n.type === "note")].sort((a, b) => {
      return (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0);
    });

    const listItems: ListItem[] = [
      ...subfolders.map((n) => ({ kind: "folder" as const, node: n })),
      ...notes.map((n) => ({ kind: "note" as const, node: n })),
    ];

    return { folderTitle: folder.title || "Untitled Folder", items: listItems };
  }, [notesTree.data, id]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === "folder") {
        return (
          <FolderRow
            node={item.node}
            T={T}
            onPress={() => router.push(`/notes/folder/${item.node.id}` as any)}
          />
        );
      }
      return (
        <NoteRow
          node={item.node}
          T={T}
          onPress={() => router.push(`/notes/${item.node.id}` as any)}
          onLongPress={() => setSheetNote({ id: item.node.id, title: item.node.title })}
          onDots={() => setSheetNote({ id: item.node.id, title: item.node.title })}
        />
      );
    },
    [T],
  );

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={folderTitle}
        color={T.accent}
        icon="notes"
        onBack={() => router.back()}
        rightActions={
          <TouchableOpacity
            onPress={() => router.push("/notes/edit" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Plus size={21} color={T.accent} weight="bold" />
          </TouchableOpacity>
        }
      />

      {notesTree.isLoading && !notesTree.data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.kind}-${item.node.id}`}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: T.textDim }]}>This folder is empty</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            items.length === 0 ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={notesTree.isFetching && !notesTree.isLoading}
              onRefresh={() => notesTree.refetch()}
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
            icon: "edit-2",
            label: "Edit note",
            onPress: () => {
              const noteId = sheetNote?.id;
              setSheetNote(null);
              router.push(`/notes/edit?noteId=${noteId}` as any);
            },
          },
          { icon: "share-2", label: "Share with team", onPress: () => {} },
          { icon: "star", label: "Add to favorites", onPress: () => {} },
          {
            icon: "trash-2",
            label: "Delete note",
            isDanger: true,
            onPress: () => {
              if (sheetNote) {
                deleteNote.mutate(sheetNote.id);
                setSheetNote(null);
              }
            },
          },
        ]}
      />
    </View>
  );
}

function FolderRow({ node, T, onPress }: { node: TreeNode; T: ThemeColors; onPress: () => void }) {
  const childCount = node.children?.length ?? 0;
  return (
    <TouchableOpacity
      style={[styles.folderRow, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.folderIcon, { backgroundColor: T.accentSoft }]}>
        <FolderSimple size={22} color={T.accent} weight="fill" />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.folderTitle, { color: T.textBright }]} numberOfLines={1}>
          {node.title || "Untitled"}
        </Text>
        {childCount > 0 && (
          <Text style={[styles.folderMeta, { color: T.textDim }]}>
            {childCount} {childCount === 1 ? "item" : "items"}
          </Text>
        )}
      </View>
      <CaretRight size={16} color={T.textDim} weight="bold" />
    </TouchableOpacity>
  );
}

function NoteRow({
  node,
  T,
  onPress,
  onLongPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  onPress: () => void;
  onLongPress: () => void;
  onDots: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.noteRow, { borderBottomColor: T.border }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={[styles.noteIcon, { backgroundColor: T.accentSoft }]}>
        <NotePencil size={16} color={T.accent} weight="fill" />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.noteTitle, { color: T.textBright }]} numberOfLines={1}>
          {node.title || "Untitled"}
        </Text>
        {node.snippet ? (
          <Text style={[styles.noteSnippet, { color: T.textDim }]} numberOfLines={1}>
            {node.snippet}
          </Text>
        ) : null}
      </View>
      <View style={styles.noteRight}>
        {node.editedAt ? (
          <Text style={[styles.noteTime, { color: T.textDim }]}>{node.editedAt}</Text>
        ) : null}
        <TouchableOpacity onPress={onDots} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <DotsThree size={18} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 24 },
  emptyContent: { flex: 1 },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  folderTitle: { fontSize: 15, fontFamily: FONT.semibold },
  folderMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowBody: { flex: 1, gap: 2 },
  noteTitle: { fontSize: 15, fontFamily: FONT.semibold },
  noteSnippet: { fontSize: 12, fontFamily: FONT.regular },
  noteRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  noteTime: { fontSize: 11, fontFamily: FONT.regular },
  emptyWrap: { paddingTop: 60, alignItems: "center" },
  emptyText: { fontSize: 14, fontFamily: FONT.regular },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
});
