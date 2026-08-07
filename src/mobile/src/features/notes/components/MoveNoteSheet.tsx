import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from "react-native";
import { Buildings, FolderSimple, LockSimple, Check } from "phosphor-react-native";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useNotesTree } from "@features/notes/useNotesTree";
import type { TreeNode } from "@features/notes/useNotesTree";
import { useMoveNote } from "@features/notes/useNoteMutations";

export type MoveTarget = {
  noteId: string;
  noteTitle: string;
  currentAccessMode: AccessMode;
  currentParentId: string | null;
};

type Space = "personal" | "organization";

type FolderOption = { id: string; title: string; depth: number };

// Flattened folder list for the picker. The moved node is skipped along with its
// whole subtree - a folder cannot become its own descendant.
function collectFolders(nodes: TreeNode[], excludeId: string, depth = 0): FolderOption[] {
  const out: FolderOption[] = [];
  for (const node of nodes) {
    if (node.type !== "folder" || node.id === excludeId) continue;
    out.push({ id: node.id, title: node.title || "Untitled", depth });
    if (node.children?.length) {
      out.push(...collectFolders(node.children, excludeId, depth + 1));
    }
  }
  return out;
}

export function MoveNoteSheet({
  target,
  onClose,
}: {
  target: MoveTarget | null;
  onClose: () => void;
}) {
  const T = useTheme();
  const notesTree = useNotesTree();
  const moveNote = useMoveNote();

  const [space, setSpace] = useState<Space>(
    target?.currentAccessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal",
  );
  const [folderId, setFolderId] = useState<string | null>(target?.currentParentId ?? null);

  // Reset when a different note opens the sheet.
  const [lastTargetId, setLastTargetId] = useState(target?.noteId ?? null);
  if (target && target.noteId !== lastTargetId) {
    setLastTargetId(target.noteId);
    setSpace(target.currentAccessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal");
    setFolderId(target.currentParentId);
  }

  const folders = useMemo(() => {
    if (!target) return [];
    const section = (notesTree.data ?? []).find((s) => s.id === space);
    return section ? collectFolders(section.nodes, target.noteId) : [];
  }, [notesTree.data, space, target]);

  const targetAccessMode =
    space === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;
  const accessModeChanged = target ? targetAccessMode !== target.currentAccessMode : false;
  const parentChanged = target ? (folderId ?? "") !== (target.currentParentId ?? "") : false;
  const canMove = accessModeChanged || parentChanged;

  const performMove = () => {
    if (!target) return;
    moveNote.mutate({
      noteId: target.noteId,
      targetAccessMode: accessModeChanged ? targetAccessMode : undefined,
      parentId: parentChanged ? (folderId ?? "") : undefined,
    });
    onClose();
  };

  const handleMove = () => {
    if (accessModeChanged && targetAccessMode === AccessMode.OPEN_TO_ORG) {
      Alert.alert(
        "Move to Organization",
        "Everyone in the organization will be able to see this note, along with anything it references - attached files, mentioned notes and inline media.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Move to Organization", onPress: performMove },
        ],
      );
      return;
    }
    performMove();
  };

  return (
    <BottomSheet visible={!!target} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
          Move {target?.noteTitle ?? ""}
        </Text>
        <Text style={[styles.subtitle, { color: T.textDim }]}>Pick a destination</Text>
      </View>

      <View style={styles.spaceRow}>
        {(
          [
            { key: "personal" as Space, label: "Personal", Icon: LockSimple },
            { key: "organization" as Space, label: "Organization", Icon: Buildings },
          ] as const
        ).map(({ key, label, Icon }) => {
          const active = space === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.spaceBtn,
                {
                  borderColor: active ? T.accent : T.border,
                  backgroundColor: active ? T.accentSoft : T.surface,
                },
              ]}
              onPress={() => {
                setSpace(key);
                setFolderId(null);
              }}
              activeOpacity={0.7}
            >
              <Icon size={18} color={active ? T.accent : T.textDim} weight="duotone" />
              <Text style={[styles.spaceLabel, { color: active ? T.accent : T.textDim }]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.folderList} showsVerticalScrollIndicator={false}>
        <FolderRow
          label="No folder"
          depth={0}
          selected={folderId === null}
          onPress={() => setFolderId(null)}
        />
        {folders.map((folder) => (
          <FolderRow
            key={folder.id}
            label={folder.title}
            depth={folder.depth + 1}
            selected={folderId === folder.id}
            onPress={() => setFolderId(folder.id)}
          />
        ))}
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.moveBtn,
          { backgroundColor: T.accent, opacity: canMove && !moveNote.isPending ? 1 : 0.4 },
        ]}
        onPress={handleMove}
        disabled={!canMove || moveNote.isPending}
        activeOpacity={0.8}
      >
        <Text style={styles.moveBtnText}>{moveNote.isPending ? "Moving..." : "Move"}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function FolderRow({
  label,
  depth,
  selected,
  onPress,
}: {
  label: string;
  depth: number;
  selected: boolean;
  onPress: () => void;
}) {
  const T = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.folderRow,
        { paddingLeft: 16 + depth * 18, backgroundColor: selected ? T.accentSoft : "transparent" },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <FolderSimple size={16} color={selected ? T.accent : T.textDim} weight="duotone" />
      <Text style={[styles.folderLabel, { color: selected ? T.accent : T.text }]} numberOfLines={1}>
        {label}
      </Text>
      {selected && <Check size={15} color={T.accent} weight="bold" />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 2 },
  title: { fontSize: 17, fontFamily: FONT.semibold },
  subtitle: { fontSize: 13, fontFamily: FONT.regular },
  spaceRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingBottom: 14 },
  spaceBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  spaceLabel: { fontSize: 14, fontFamily: FONT.medium },
  folderList: { maxHeight: 260 },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 16,
    paddingVertical: 11,
  },
  folderLabel: { flex: 1, fontSize: 14, fontFamily: FONT.regular },
  moveBtn: {
    marginHorizontal: 20,
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 11,
    alignItems: "center",
  },
  moveBtnText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
});
