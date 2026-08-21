import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import {
  Plus,
  DotsThree,
  NotePencil,
  FolderSimple,
  Atom,
  Graph,
  Trash,
  Rows,
  SquaresFour,
  SortAscending,
  SortDescending,
} from "phosphor-react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { ShareSheet } from "@shared/permissions/ShareSheet";
import { AccessMode, ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useDeleteNote } from "@features/notes/useNoteMutations";
import { useNotesTree } from "@features/notes/useNotesTree";
import type { TreeNode, TreeSection } from "@features/notes/useNotesTree";
import { MoveNoteSheet } from "@features/notes/components/MoveNoteSheet";
import type { MoveTarget } from "@features/notes/components/MoveNoteSheet";
import { CreateNoteSheet } from "@features/notes/components/CreateNoteSheet";
import { FolderActionSheet } from "@features/notes/components/FolderActionSheet";
import type { FolderTarget } from "@features/notes/components/FolderActionSheet";
import {
  DraggableNote,
  FolderDropTarget,
  NoteDragProvider,
  toDragNote,
  useNoteDragList,
} from "@features/notes/components/NoteDrag";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";

type FilterKey = "all" | "personal" | "shared" | "organization";

type SheetNote = {
  id: string;
  title: string;
  isCanvas: boolean;
  accessMode: number;
  parentId: string | null;
};

function toSheetNote(node: TreeNode): SheetNote {
  return {
    id: node.id,
    title: node.title,
    isCanvas: node.isCanvas,
    accessMode: node.accessMode,
    parentId: node.parentId ?? null,
  };
}

function toFolderTarget(node: TreeNode): FolderTarget {
  return {
    id: node.id,
    title: node.title,
    accessMode: node.accessMode,
    parentId: node.parentId ?? null,
    childCount: node.children?.length ?? 0,
  };
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "shared", label: "Shared" },
  { key: "organization", label: "Organization" },
];

function getRootFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.type === "folder");
}

// Notes nested in folders live behind their folder row; listing them here too
// would render every foldered note twice.
function getRootNotes(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.type === "note");
}

type SortKey = "name" | "updated";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = { name: "Name", updated: "Last edited" };

const SORT_OPTIONS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: "updated", dir: "desc", label: "Last edited (newest)" },
  { key: "updated", dir: "asc", label: "Last edited (oldest)" },
  { key: "name", dir: "asc", label: "Name (A-Z)" },
  { key: "name", dir: "desc", label: "Name (Z-A)" },
];

function sortNodes(nodes: TreeNode[], key: SortKey, dir: SortDir): TreeNode[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (key === "name") {
      return factor * a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    }
    return factor * ((a.updatedAt?.seconds ?? 0) - (b.updatedAt?.seconds ?? 0));
  });
}

export function NotesListScreen() {
  return (
    <NoteDragProvider>
      <NotesListBody />
    </NoteDragProvider>
  );
}

function NotesListBody() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const notesTree = useNotesTree();
  const deleteNote = useDeleteNote();
  const { setListRef, onListScroll } = useNoteDragList();
  const [sheetNote, setSheetNote] = useState<SheetNote | null>(null);
  const [folderTarget, setFolderTarget] = useState<FolderTarget | null>(null);
  const [shareNoteId, setShareNoteId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [gridMode, setGridMode] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);

  // Creating while a space is filtered should land in that space, the way web
  // creates into whichever sidebar section the action came from.
  const createAccessMode =
    filter === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;

  const sheetUrn = sheetNote ? `urn:uniffy:content:NOTE:${sheetNote.id}` : "";
  const sheetBookmarked = useIsBookmarked(sheetUrn).data ?? false;
  const toggleBookmark = useToggleBookmark();

  // Folders first, then notes - the same ordering the files domain uses, so a
  // folder never gets buried under a long note list.
  const items = useMemo(() => {
    const sections: TreeSection[] = notesTree.data ?? [];
    const scoped = filter === "all" ? sections : sections.filter((s) => s.id === filter);

    const folders: TreeNode[] = [];
    const notes: TreeNode[] = [];
    for (const s of scoped) {
      folders.push(...getRootFolders(s.nodes));
      notes.push(...getRootNotes(s.nodes));
    }

    return [...sortNodes(folders, sortKey, sortDir), ...sortNodes(notes, sortKey, sortDir)];
  }, [notesTree.data, filter, sortKey, sortDir]);

  const renderItem = useCallback(
    ({ item }: { item: TreeNode }) => {
      if (item.type === "folder") {
        const openFolderSheet = () => setFolderTarget(toFolderTarget(item));
        return (
          <DraggableNote note={toDragNote(item)} style={gridMode ? styles.gridItemWrap : undefined}>
            <FolderDropTarget
              folder={{ id: item.id, accessMode: item.accessMode }}
              style={gridMode ? styles.gridItemWrap : undefined}
            >
              {(active) =>
                gridMode ? (
                  <FolderCard
                    node={item}
                    T={T}
                    highlighted={active}
                    onPress={() => router.push(`/notes/folder/${item.id}` as any)}
                    onDots={openFolderSheet}
                  />
                ) : (
                  <FolderRow
                    node={item}
                    T={T}
                    highlighted={active}
                    onPress={() => router.push(`/notes/folder/${item.id}` as any)}
                    onDots={openFolderSheet}
                  />
                )
              }
            </FolderDropTarget>
          </DraggableNote>
        );
      }

      const open = () => setSheetNote(toSheetNote(item));
      return (
        <DraggableNote note={toDragNote(item)} style={gridMode ? styles.gridItemWrap : undefined}>
          {gridMode ? (
            <NoteCard
              node={item}
              T={T}
              onPress={() => router.push(`/notes/${item.id}` as any)}
              onDots={open}
            />
          ) : (
            <NoteRow
              node={item}
              T={T}
              onPress={() => router.push(`/notes/${item.id}` as any)}
              onDots={open}
            />
          )}
        </DraggableNote>
      );
    },
    [T, gridMode],
  );

  const listEmpty = notesTree.isLoading ? null : <EmptyNotes filter={filter} />;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Notes"
        color={T.accent}
        icon="notes"
        rightActions={
          <>
            <TouchableOpacity
              onPress={() => router.push("/notes/graph" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Atom size={19} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/notes/trash" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Trash size={19} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCreateOpen(true)}
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
                  ? { backgroundColor: T.accent }
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

      <View style={[styles.sortBar, { borderBottomColor: T.border }]}>
        <TouchableOpacity
          style={styles.sortBtn}
          activeOpacity={0.7}
          onPress={() => setSortSheetOpen(true)}
        >
          <Text style={[styles.sortText, { color: T.textDim }]}>{SORT_LABELS[sortKey]}</Text>
          {sortDir === "asc" ? (
            <SortAscending size={14} color={T.textDim} weight="duotone" />
          ) : (
            <SortDescending size={14} color={T.textDim} weight="duotone" />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setGridMode((v) => !v)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {gridMode ? (
            <Rows size={18} color={T.text} weight="duotone" />
          ) : (
            <SquaresFour size={18} color={T.text} weight="duotone" />
          )}
        </TouchableOpacity>
      </View>

      {notesTree.isLoading && !notesTree.data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          // numColumns cannot change on a live list, so the mode is keyed in.
          key={gridMode ? "grid" : "list"}
          ref={setListRef}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={gridMode ? 2 : 1}
          columnWrapperStyle={gridMode ? styles.gridRow : undefined}
          ListEmptyComponent={listEmpty}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            items.length === 0
              ? styles.emptyContent
              : gridMode
                ? styles.gridContent
                : styles.listContent,
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
          ...(sheetNote?.isCanvas
            ? []
            : [
                {
                  icon: "edit-2",
                  label: "Edit note",
                  onPress: () => {
                    const id = sheetNote?.id;
                    setSheetNote(null);
                    router.push(`/notes/edit?noteId=${id}` as any);
                  },
                },
              ]),
          {
            icon: "at-sign",
            label: "Copy reference link",
            sublabel: `@${sheetNote?.title?.toLowerCase().replace(/ /g, "-")}`,
            onPress: () => {
              if (sheetNote) {
                Clipboard.setStringAsync(sheetUrn);
                Alert.alert("Copied", "Reference link copied to clipboard.");
              }
            },
          },
          {
            icon: "share-2",
            label: "Share with team",
            onPress: () => setShareNoteId(sheetNote?.id ?? null),
          },
          {
            icon: "folder",
            label: "Move to...",
            onPress: () => {
              if (sheetNote) {
                setMoveTarget({
                  noteId: sheetNote.id,
                  noteTitle: sheetNote.title,
                  currentAccessMode: sheetNote.accessMode,
                  currentParentId: sheetNote.parentId,
                });
              }
              setSheetNote(null);
            },
          },
          {
            icon: "star",
            label: sheetBookmarked ? "Remove from favorites" : "Add to favorites",
            onPress: () => {
              if (sheetUrn) toggleBookmark.mutate(sheetUrn);
              setSheetNote(null);
            },
          },
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
        color={T.accent}
      />

      <FolderActionSheet
        target={folderTarget}
        onClose={() => setFolderTarget(null)}
        onMove={(folder) =>
          setMoveTarget({
            noteId: folder.id,
            noteTitle: folder.title,
            currentAccessMode: folder.accessMode,
            currentParentId: folder.parentId,
          })
        }
        onShare={setShareNoteId}
      />

      <MoveNoteSheet target={moveTarget} onClose={() => setMoveTarget(null)} />

      <CreateNoteSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        accessMode={createAccessMode}
      />

      <ActionSheet
        visible={sortSheetOpen}
        onClose={() => setSortSheetOpen(false)}
        title="Sort by"
        icon="notes"
        iconColor={T.accent}
        actions={SORT_OPTIONS.map((option) => ({
          icon: option.dir === "asc" ? "sort-asc" : "sort-desc",
          label: option.label,
          color: sortKey === option.key && sortDir === option.dir ? T.accent : undefined,
          onPress: () => {
            setSortKey(option.key);
            setSortDir(option.dir);
            setSortSheetOpen(false);
          },
        }))}
      />
    </View>
  );
}

function NoteRow({
  node,
  T,
  onPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  onPress: () => void;
  onDots: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.noteRow, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.noteRowIcon, { backgroundColor: T.accentSoft }]}>
        {node.icon?.value ? (
          <Text style={styles.noteRowEmoji}>{node.icon.value}</Text>
        ) : node.isCanvas ? (
          <Graph size={16} color={T.accent} weight="duotone" />
        ) : (
          <NotePencil size={16} color={T.accent} weight="fill" />
        )}
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

function FolderRow({
  node,
  T,
  highlighted,
  onPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  highlighted: boolean;
  onPress: () => void;
  onDots: () => void;
}) {
  const childCount = node.children?.length ?? 0;
  return (
    <TouchableOpacity
      style={[
        styles.folderRow,
        { borderBottomColor: T.border },
        highlighted && { backgroundColor: T.accentSoft },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.folderIcon, { backgroundColor: T.accentSoft }]}>
        <FolderSimple size={24} color={T.accent} weight="fill" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, { color: T.textBright }]} numberOfLines={1}>
          {node.title || "Untitled"}
        </Text>
        <Text style={[styles.itemMeta, { color: T.textDim }]}>
          {childCount} {childCount === 1 ? "item" : "items"}
        </Text>
      </View>
      <TouchableOpacity onPress={onDots} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <DotsThree size={22} color={T.textDim} weight="bold" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function FolderCard({
  node,
  T,
  highlighted,
  onPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  highlighted: boolean;
  onPress: () => void;
  onDots: () => void;
}) {
  const childCount = node.children?.length ?? 0;
  return (
    <TouchableOpacity
      style={[
        styles.gridCard,
        { backgroundColor: T.surface, borderColor: T.border },
        highlighted && { backgroundColor: T.accentSoft, borderColor: T.accent, borderWidth: 1 },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.gridCardTop}>
        <FolderSimple size={40} color={T.accent} weight="fill" />
        <TouchableOpacity onPress={onDots} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <DotsThree size={20} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>
      <Text style={[styles.gridCardName, { color: T.textBright }]} numberOfLines={2}>
        {node.title || "Untitled"}
      </Text>
      <Text style={[styles.gridCardMeta, { color: T.textDim }]}>
        {childCount} {childCount === 1 ? "item" : "items"}
      </Text>
    </TouchableOpacity>
  );
}

function NoteCard({
  node,
  T,
  onPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  onPress: () => void;
  onDots: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.gridCard, { backgroundColor: T.surface, borderColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.gridCardTop}>
        {node.icon?.value ? (
          <Text style={styles.gridCardEmoji}>{node.icon.value}</Text>
        ) : node.isCanvas ? (
          <Graph size={34} color={T.accent} weight="duotone" />
        ) : (
          <NotePencil size={34} color={T.accent} weight="duotone" />
        )}
        <TouchableOpacity onPress={onDots} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <DotsThree size={20} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>
      <Text style={[styles.gridCardName, { color: T.textBright }]} numberOfLines={2}>
        {node.title || "Untitled"}
      </Text>
      {node.editedAt ? (
        <Text style={[styles.gridCardMeta, { color: T.textDim }]}>{node.editedAt}</Text>
      ) : null}
    </TouchableOpacity>
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
      <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
        <NotePencil size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No notes yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Create your first note to get started
      </Text>
      <TouchableOpacity
        style={[styles.emptyCta, { backgroundColor: T.accent }]}
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
  // flexShrink 0 on both chrome bars: they sit in a flex column above the list,
  // and without it the column squeezes them under their content height, which
  // clips the pill labels. Neither sets a fixed height, so both still grow with
  // the system font scale.
  filterBar: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    justifyContent: "center",
  },
  filterPillText: {
    fontSize: 13,
    fontFamily: FONT.medium,
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
  noteRowEmoji: { fontSize: 18 },
  noteRowBody: { flex: 1, gap: 2 },
  noteRowTitle: { fontSize: 15, fontFamily: FONT.semibold },
  noteRowSnippet: { fontSize: 12, fontFamily: FONT.regular },
  noteRowRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  noteRowTime: { fontSize: 11, fontFamily: FONT.regular },
  sortBar: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  sortText: { fontSize: 13, fontFamily: FONT.medium },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  itemName: { fontSize: 15, fontFamily: FONT.semibold },
  itemMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 3 },
  gridContent: { padding: 16, gap: 12 },
  gridRow: { gap: 12 },
  gridItemWrap: { flex: 1 },
  gridCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  gridCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    minHeight: 44,
  },
  gridCardEmoji: { fontSize: 32 },
  gridCardName: { fontSize: 13, fontFamily: FONT.semibold, lineHeight: 18 },
  gridCardMeta: { fontSize: 11, fontFamily: FONT.regular },
  sectionEmpty: {
    paddingTop: 40,
    alignItems: "center",
  },
  sectionEmptyText: { fontSize: 14, fontFamily: FONT.regular },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
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
  emptyCta: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 10,
  },
  emptyCtaText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
});
