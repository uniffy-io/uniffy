import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { ActionSheet } from "@shared/components/ActionSheet";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { useDeleteNote, useUpdateNote } from "@features/notes/useNoteMutations";

export type FolderTarget = {
  id: string;
  title: string;
  accessMode: number;
  parentId: string | null;
  childCount: number;
};

export function FolderActionSheet({
  target,
  onClose,
  onMove,
  onShare,
}: {
  target: FolderTarget | null;
  onClose: () => void;
  onMove: (target: FolderTarget) => void;
  onShare: (folderId: string) => void;
}) {
  const T = useTheme();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  // The sheet closes itself on every action, so a follow-up flow keeps its own
  // copy of the folder rather than reading a target that is already null.
  const [renameTarget, setRenameTarget] = useState<FolderTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const urn = target ? `urn:uniffy:content:NOTE:${target.id}` : "";
  const bookmarked = useIsBookmarked(urn).data ?? false;
  const toggleBookmark = useToggleBookmark();

  const submitRename = () => {
    const title = renameValue.trim();
    if (!renameTarget || !title) return;
    updateNote.mutate(
      { noteId: renameTarget.id, title },
      { onSuccess: () => setRenameTarget(null) },
    );
  };

  const confirmDelete = (folder: FolderTarget) => {
    Alert.alert(
      "Delete folder",
      folder.childCount > 0
        ? `"${folder.title}" and everything inside it will move to trash.`
        : `"${folder.title}" will move to trash.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteNote.mutate(folder.id),
        },
      ],
    );
  };

  return (
    <>
      <ActionSheet
        visible={!!target}
        onClose={onClose}
        title={target?.title ?? ""}
        subtitle={
          target && target.childCount > 0
            ? `${target.childCount} ${target.childCount === 1 ? "item" : "items"}`
            : undefined
        }
        icon="folder"
        iconColor={T.accent}
        actions={[
          {
            icon: "edit-2",
            label: "Rename folder",
            onPress: () => {
              if (target) {
                setRenameValue(target.title);
                setRenameTarget(target);
              }
            },
          },
          {
            icon: "share-2",
            label: "Share with team",
            onPress: () => {
              if (target) onShare(target.id);
            },
          },
          {
            icon: "folder",
            label: "Move to...",
            onPress: () => {
              if (target) onMove(target);
            },
          },
          {
            icon: "star",
            label: bookmarked ? "Remove from favorites" : "Add to favorites",
            onPress: () => {
              if (urn) toggleBookmark.mutate(urn);
            },
          },
          {
            icon: "trash-2",
            label: "Delete folder",
            isDanger: true,
            onPress: () => {
              if (target) confirmDelete(target);
            },
          },
        ]}
      />

      <BottomSheet visible={!!renameTarget} onClose={() => setRenameTarget(null)}>
        <View style={styles.renameBody}>
          <Text style={[styles.renameTitle, { color: T.textBright }]}>Rename folder</Text>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Folder name"
            placeholderTextColor={T.textDim}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={submitRename}
            style={[
              styles.renameInput,
              { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
            ]}
          />
          <TouchableOpacity
            style={[
              styles.renameBtn,
              { backgroundColor: T.accent, opacity: renameValue.trim() ? 1 : 0.4 },
            ]}
            onPress={submitRename}
            disabled={!renameValue.trim() || updateNote.isPending}
            activeOpacity={0.8}
          >
            {updateNote.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.renameBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  renameBody: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  renameTitle: { fontSize: 17, fontFamily: FONT.semibold },
  renameInput: {
    fontSize: 15,
    fontFamily: FONT.regular,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  renameBtn: { paddingVertical: 13, borderRadius: 11, alignItems: "center" },
  renameBtnText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
});
