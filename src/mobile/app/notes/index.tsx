import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import {
  MagnifyingGlass,
  Plus,
  DotsThree,
  NotePencil,
  FolderSimple,
  Atom,
} from "phosphor-react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { DomainHeader } from "@/components/DomainHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { ShareSheet } from "@/components/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { DOMAIN_COLORS } from "@/constants/theme";
import { useDeleteNote } from "@/hooks/useNoteMutations";
import { useNotesTree } from "@/hooks/useNotesTree";
import type { TreeNode, TreeSection } from "@/hooks/useNotesTree";

type FilterKey = "all" | "personal" | "shared" | "organization";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "shared", label: "Shared" },
  { key: "organization", label: "Organization" },
];

function flattenNotes(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "note") {
      result.push(node);
    } else if (node.children?.length) {
      result.push(...flattenNotes(node.children));
    }
  }
  return result;
}

function sortByUpdatedAt(notes: TreeNode[]): TreeNode[] {
  return [...notes].sort((a, b) => {
    const aTime = a.updatedAt?.seconds ?? 0;
    const bTime = b.updatedAt?.seconds ?? 0;
    return bTime - aTime;
  });
}

function getRootFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.type === "folder");
}

export default function NotesListScreen() {
  const T = useTheme();
  const notesTree = useNotesTree();
  const deleteNote = useDeleteNote();
  const [sheetNote, setSheetNote] = useState<{ id: string; title: string } | null>(null);
  const [shareNoteId, setShareNoteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  const { folderChips, notes } = useMemo(() => {
    const sections: TreeSection[] = notesTree.data ?? [];

    if (filter === "all") {
      const all: TreeNode[] = [];
      for (const s of sections) all.push(...flattenNotes(s.nodes));
      return { folderChips: [] as TreeNode[], notes: sortByUpdatedAt(all) };
    }

    const section = sections.find((s) => s.id === filter);
    if (!section) return { folderChips: [] as TreeNode[], notes: [] as TreeNode[] };

    return {
      folderChips: getRootFolders(section.nodes),
      notes: sortByUpdatedAt(flattenNotes(section.nodes)),
    };
  }, [notesTree.data, filter]);

  const renderItem = useCallback(
    ({ item }: { item: TreeNode }) => (
      <NoteRow
        node={item}
        T={T}
        onPress={() => router.push(`/notes/${item.id}` as any)}
        onLongPress={() => setSheetNote({ id: item.id, title: item.title })}
        onDots={() => setSheetNote({ id: item.id, title: item.title })}
      />
    ),
    [T],
  );

  const listHeader = useMemo(
    () => (folderChips.length > 0 ? <FolderChips folders={folderChips} T={T} /> : null),
    [folderChips, T],
  );

  const listEmpty = notesTree.isLoading ? null : <EmptyNotes filter={filter} />;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Notes"
        color={DOMAIN_COLORS.notes}
        icon="notes"
        rightActions={
          <>
            <TouchableOpacity
              onPress={() => router.push("/search" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MagnifyingGlass size={19} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/notes/graph" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Atom size={19} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/notes/edit" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Plus size={21} color={T.accent} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: T.border }]}
        contentContainerStyle={styles.filterBarContent}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterPill,
                active
                  ? { backgroundColor: DOMAIN_COLORS.notes }
                  : {
                      backgroundColor: T.surface,
                      borderColor: T.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterPillText, { color: active ? "#fff" : T.textDim }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {notesTree.isLoading && !notesTree.data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.notes} />
        </View>
      ) : (
        <FlatList
          data={notes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={notes.length === 0 ? styles.emptyContent : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={notesTree.isFetching && !notesTree.isLoading}
              onRefresh={() => notesTree.refetch()}
              tintColor={DOMAIN_COLORS.notes}
              colors={[DOMAIN_COLORS.notes]}
            />
          }
        />
      )}

      <ActionSheet
        visible={!!sheetNote}
        onClose={() => setSheetNote(null)}
        title={sheetNote?.title ?? ""}
        icon="notes"
        iconColor={DOMAIN_COLORS.notes}
        actions={[
          {
            icon: "edit-2",
            label: "Edit note",
            onPress: () => {
              const id = sheetNote?.id;
              setSheetNote(null);
              router.push(`/notes/edit?noteId=${id}` as any);
            },
          },
          {
            icon: "at-sign",
            label: "Copy reference link",
            sublabel: `@${sheetNote?.title?.toLowerCase().replace(/ /g, "-")}`,
            onPress: () => {
              if (sheetNote) {
                Clipboard.setStringAsync(`urn:uniffy:content:NOTE:${sheetNote.id}`);
                Alert.alert("Copied", "Reference link copied to clipboard.");
              }
            },
          },
          {
            icon: "share-2",
            label: "Share with team",
            onPress: () => setShareNoteId(sheetNote?.id ?? null),
          },
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

      <ShareSheet
        visible={!!shareNoteId}
        onClose={() => setShareNoteId(null)}
        contentType={ContentType.NOTE}
        contentId={shareNoteId ?? ""}
        color={DOMAIN_COLORS.notes}
      />
    </View>
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
      <View style={[styles.noteRowIcon, { backgroundColor: DOMAIN_COLORS.notesSoft }]}>
        <NotePencil size={16} color={DOMAIN_COLORS.notes} weight="fill" />
      </View>
      <View style={styles.noteRowBody}>
        <Text style={[styles.noteRowTitle, { color: T.textBright }]} numberOfLines={1}>
          {node.title || "Untitled"}
        </Text>
        {node.snippet ? (
          <Text style={[styles.noteRowSnippet, { color: T.textDim }]} numberOfLines={1}>
            {node.snippet}
          </Text>
        ) : null}
      </View>
      <View style={styles.noteRowRight}>
        {node.editedAt ? (
          <Text style={[styles.noteRowTime, { color: T.textDim }]}>{node.editedAt}</Text>
        ) : null}
        <TouchableOpacity onPress={onDots} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <DotsThree size={18} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function FolderChips({ folders, T }: { folders: TreeNode[]; T: ThemeColors }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsScroll}
      contentContainerStyle={styles.chipsContent}
    >
      {folders.map((folder) => (
        <TouchableOpacity
          key={folder.id}
          style={[styles.folderChip, { backgroundColor: T.surface, borderColor: T.border }]}
          onPress={() => router.push(`/notes/folder/${folder.id}` as any)}
          activeOpacity={0.7}
        >
          <FolderSimple size={14} color={DOMAIN_COLORS.notes} weight="fill" />
          <Text style={[styles.chipLabel, { color: T.textBright }]} numberOfLines={1}>
            {folder.title || "Untitled"}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function EmptyNotes({ filter }: { filter: FilterKey }) {
  const T = useTheme();
  if (filter !== "all") {
    return (
      <View style={styles.sectionEmpty}>
        <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>
          No notes in this section
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: DOMAIN_COLORS.notesSoft }]}>
        <NotePencil size={36} color={DOMAIN_COLORS.notes} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No notes yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Create your first note to get started
      </Text>
      <TouchableOpacity
        style={[styles.emptyCta, { backgroundColor: DOMAIN_COLORS.notes }]}
        onPress={() => router.push("/notes/edit" as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.emptyCtaText}>Create note</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBar: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  filterPillText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  listContent: { paddingBottom: 24 },
  emptyContent: { flex: 1 },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  noteRowBody: { flex: 1, gap: 2 },
  noteRowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  noteRowSnippet: { fontSize: 12, fontFamily: "Inter_400Regular" },
  noteRowRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  noteRowTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  chipsScroll: { flexGrow: 0 },
  chipsContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: "row",
  },
  folderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 160,
  },
  chipLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1 },
  sectionEmpty: {
    paddingTop: 40,
    alignItems: "center",
  },
  sectionEmptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  emptyCta: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 10,
  },
  emptyCtaText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
});
