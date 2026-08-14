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
import {
  DotsThree,
  NotePencil,
  Plus,
  FolderSimple,
  CaretRight,
  Graph,
} from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { ShareSheet } from "@shared/permissions/ShareSheet";
import { AccessMode, ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useDeleteNote } from "@features/notes/useNoteMutations";
import { useNoteBreadcrumb, useNotesTree } from "@features/notes/useNotesTree";
import type { TreeNode } from "@features/notes/useNotesTree";
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

type ListItem = { kind: "folder"; node: TreeNode } | { kind: "note"; node: TreeNode };

type SheetNote = {
  id: string;
  title: string;
  isCanvas: boolean;
  accessMode: number;
  parentId: string | null;
};

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

export function NotesFolderScreen() {
  return (
    <NoteDragProvider>
      <NotesFolderBody />
    </NoteDragProvider>
  );
}

function NotesFolderBody() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const breadcrumb = useNoteBreadcrumb(id);

  const sheetUrn = sheetNote ? `urn:uniffy:content:NOTE:${sheetNote.id}` : "";
  const sheetBookmarked = useIsBookmarked(sheetUrn).data ?? false;
  const toggleBookmark = useToggleBookmark();

  const { folderTitle, folderAccessMode, items } = useMemo(() => {
    const sections = notesTree.data ?? [];
    const allNodes: TreeNode[] = [];
    for (const s of sections) allNodes.push(...s.nodes);

    const folder = findNode(allNodes, id);
    if (!folder) {
      return {
        folderTitle: "Folder",
        folderAccessMode: AccessMode.OWNER_ONLY as AccessMode,
        items: [] as ListItem[],
      };
    }

    const children = folder.children ?? [];
    const subfolders = children.filter((n) => n.type === "folder");
    const notes = children
      .filter((n) => n.type === "note")
      .sort((a, b) => {
        return (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0);
      });

    const listItems: ListItem[] = [
      ...subfolders.map((n) => ({ kind: "folder" as const, node: n })),
      ...notes.map((n) => ({ kind: "note" as const, node: n })),
    ];

    return {
      folderTitle: folder.title || "Untitled Folder",
      folderAccessMode: folder.accessMode as AccessMode,
      items: listItems,
    };
  }, [notesTree.data, id]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === "folder") {
        const openFolderSheet = () =>
          setFolderTarget({
            id: item.node.id,
            title: item.node.title,
            accessMode: item.node.accessMode,
            parentId: item.node.parentId ?? null,
            childCount: item.node.children?.length ?? 0,
          });
        return (
          <DraggableNote note={toDragNote(item.node)}>
            <FolderDropTarget folder={{ id: item.node.id, accessMode: item.node.accessMode }}>
              {(active) => (
                <FolderRow
                  node={item.node}
                  T={T}
                  highlighted={active}
                  onPress={() => router.push(`/notes/folder/${item.node.id}` as any)}
                  onDots={openFolderSheet}
                />
              )}
            </FolderDropTarget>
          </DraggableNote>
        );
      }
      const open = () =>
        setSheetNote({
          id: item.node.id,
          title: item.node.title,
          isCanvas: item.node.isCanvas,
          accessMode: item.node.accessMode,
          parentId: item.node.parentId ?? null,
        });
      return (
        <DraggableNote note={toDragNote(item.node)}>
          <NoteRow
            node={item.node}
            T={T}
            onPress={() => router.push(`/notes/${item.node.id}` as any)}
            onDots={open}
          />
        </DraggableNote>
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
            onPress={() => setCreateOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Plus size={21} color={T.accent} weight="bold" />
          </TouchableOpacity>
        }
      />

      {breadcrumb.length > 0 && (
        <View style={[styles.breadcrumbRow, { borderBottomColor: T.border }]}>
          {breadcrumb.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <CaretRight size={11} color={T.textDim} weight="bold" />}
              <TouchableOpacity
                onPress={() => router.push(`/notes/folder/${crumb.id}` as any)}
                activeOpacity={0.7}
              >
                <Text style={[styles.breadcrumb, { color: T.textDim }]} numberOfLines={1}>
                  {crumb.title}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      )}

      {notesTree.isLoading && !notesTree.data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          ref={setListRef}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.kind}-${item.node.id}`}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: T.textDim }]}>This folder is empty</Text>
              <TouchableOpacity
                style={[styles.emptyCta, { backgroundColor: T.accent }]}
                onPress={() => setCreateOpen(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.emptyCtaText}>Create note here</Text>
              </TouchableOpacity>
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
          ...(sheetNote?.isCanvas
            ? []
            : [
                {
                  icon: "edit-2",
                  label: "Edit note",
                  onPress: () => {
                    const noteId = sheetNote?.id;
                    setSheetNote(null);
                    router.push(`/notes/edit?noteId=${noteId}` as any);
                  },
                },
              ]),
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
        parentId={id}
        accessMode={folderAccessMode}
        lockSpace
      />
    </View>
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
      <TouchableOpacity onPress={onDots} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <DotsThree size={22} color={T.textDim} weight="bold" />
      </TouchableOpacity>
    </TouchableOpacity>
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
      <View style={[styles.noteIcon, { backgroundColor: T.accentSoft }]}>
        {node.icon?.value ? (
          <Text style={styles.noteEmoji}>{node.icon.value}</Text>
        ) : node.isCanvas ? (
          <Graph size={16} color={T.accent} weight="duotone" />
        ) : (
          <NotePencil size={16} color={T.accent} weight="fill" />
        )}
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
  breadcrumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  breadcrumb: { fontSize: 12, fontFamily: FONT.medium },
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
  noteEmoji: { fontSize: 18 },
  noteTitle: { fontSize: 15, fontFamily: FONT.semibold },
  noteSnippet: { fontSize: 12, fontFamily: FONT.regular },
  noteRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  noteTime: { fontSize: 11, fontFamily: FONT.regular },
  emptyWrap: { paddingTop: 60, alignItems: "center", gap: 16 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular },
  emptyCta: {
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 10,
  },
  emptyCtaText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
});
