import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  MagnifyingGlass,
  Plus,
  DotsThree,
  FolderSimple,
  SquaresFour,
  Rows,
  CaretRight,
  SortAscending,
} from "phosphor-react-native";
import { router } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { useTheme } from "@/hooks/useTheme";
import { FILE_COLORS } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import { useFilesTree } from "@/hooks/useFiles";
import type { PlainTreeNode } from "@/lib/fileSerializer";
import {
  useDeleteFile,
  useDeleteFolder,
  useCreateFolder,
  useUploadFile,
  useUpdateFile,
  useUpdateFolder,
  useMoveItems,
} from "@/hooks/useFileMutations";
import * as DocumentPicker from "expo-document-picker";

function getFileColor(ext: string) {
  return FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
}

type FolderOption = { id: string; name: string; depth: number };

// Flat list of folders for the move picker. Skips the subtree rooted at
// `excludeId` so a folder can never be moved into itself or a descendant.
function flattenFolders(
  nodes: PlainTreeNode[],
  excludeId: string | undefined,
  depth = 0,
): FolderOption[] {
  const out: FolderOption[] = [];
  for (const node of nodes) {
    if (!node.isFolder || node.id === excludeId) continue;
    out.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      out.push(...flattenFolders(node.children, excludeId, depth + 1));
    }
  }
  return out;
}

type SheetItem = { id: string; name: string; isFolder: boolean; ext?: string } | null;

export default function FilesListScreen() {
  const T = useTheme();
  const filesTree = useFilesTree();
  const deleteFile = useDeleteFile();
  const deleteFolder = useDeleteFolder();
  const [gridMode, setGridMode] = useState(false);
  const [sheetItem, setSheetItem] = useState<SheetItem>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [createFolderVisible, setCreateFolderVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<SheetItem>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState<SheetItem>(null);
  const createFolder = useCreateFolder();
  const uploadFile = useUploadFile();
  const updateFile = useUpdateFile();
  const updateFolder = useUpdateFolder();
  const moveItems = useMoveItems();

  const startRename = useCallback((item: NonNullable<SheetItem>) => {
    setSheetItem(null);
    setRenameValue(item.name);
    setRenameTarget(item);
  }, []);

  const submitRename = useCallback(() => {
    const name = renameValue.trim();
    if (!renameTarget || !name) return;
    const onSettled = () => setRenameTarget(null);
    if (renameTarget.isFolder) {
      updateFolder.mutate({ folderId: renameTarget.id, name }, { onSettled });
    } else {
      updateFile.mutate({ fileId: renameTarget.id, filename: name }, { onSettled });
    }
  }, [renameTarget, renameValue, updateFile, updateFolder]);

  const doMove = useCallback(
    (targetFolderId: string | undefined) => {
      if (!moveTarget) return;
      moveItems.mutate(
        {
          fileIds: moveTarget.isFolder ? [] : [moveTarget.id],
          folderIds: moveTarget.isFolder ? [moveTarget.id] : [],
          targetFolderId,
        },
        { onSettled: () => setMoveTarget(null) },
      );
    },
    [moveTarget, moveItems],
  );

  const copyReferenceLink = useCallback(async (item: NonNullable<SheetItem>) => {
    const type = item.isFolder ? "FOLDER" : "FILE";
    await Clipboard.setStringAsync(`urn:uniffy:content:${type}:${item.id}`);
    Alert.alert("Copied", "Reference link copied to clipboard.");
  }, []);
  // Folder navigation stack: array of { id, name } for breadcrumb
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null;
  const currentFolderName =
    folderStack.length > 0 ? folderStack[folderStack.length - 1].name : "Files";

  // Derive current folder's children from tree data
  const currentChildren = useMemo(() => {
    if (!filesTree.data) return [];
    if (!currentFolderId) return filesTree.data;
    // Walk the tree to find the current folder
    const findFolder = (nodes: PlainTreeNode[]): PlainTreeNode | null => {
      for (const node of nodes) {
        if (node.id === currentFolderId) return node;
        if (node.isFolder && node.children.length > 0) {
          const found = findFolder(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const folder = findFolder(filesTree.data);
    return folder?.children ?? [];
  }, [filesTree.data, currentFolderId]);

  const folders = useMemo(() => currentChildren.filter((n) => n.isFolder), [currentChildren]);
  const files = useMemo(() => currentChildren.filter((n) => !n.isFolder), [currentChildren]);

  const navigateIntoFolder = useCallback((node: PlainTreeNode) => {
    setFolderStack((prev) => [...prev, { id: node.id, name: node.name }]);
  }, []);

  const navigateBack = useCallback(() => {
    setFolderStack((prev) => prev.slice(0, -1));
  }, []);

  const handleUpload = useCallback(async () => {
    setAddSheetOpen(false);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    uploadFile.mutate({
      uri: asset.uri,
      filename: asset.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 0,
      folderId: currentFolderId ?? undefined,
    });
  }, [currentFolderId, uploadFile]);

  // ---- Renderers ----

  const renderFolderRow = (node: PlainTreeNode) => (
    <TouchableOpacity
      key={node.id}
      style={[styles.folderRow, { borderBottomColor: T.border }]}
      onPress={() => navigateIntoFolder(node)}
      onLongPress={() => setSheetItem({ id: node.id, name: node.name, isFolder: true })}
      activeOpacity={0.7}
    >
      <View style={[styles.folderIcon, { backgroundColor: T.domains.filesSoft }]}>
        <FolderSimple size={24} color={T.domains.files} weight="fill" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, { color: T.textBright }]} numberOfLines={1}>
          {node.name}
        </Text>
        <Text style={[styles.itemMeta, { color: T.textDim }]}>
          {node.childCount} {node.childCount === 1 ? "item" : "items"}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => setSheetItem({ id: node.id, name: node.name, isFolder: true })}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <DotsThree size={22} color={T.textDim} weight="bold" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderFolderGrid = (node: PlainTreeNode) => (
    <TouchableOpacity
      key={node.id}
      style={[styles.gridCard, { backgroundColor: T.surface, borderColor: T.border }]}
      onPress={() => navigateIntoFolder(node)}
      onLongPress={() => setSheetItem({ id: node.id, name: node.name, isFolder: true })}
      activeOpacity={0.7}
    >
      <View style={styles.gridCardTop}>
        <FolderSimple size={40} color={T.domains.files} weight="fill" />
        <TouchableOpacity
          onPress={() => setSheetItem({ id: node.id, name: node.name, isFolder: true })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.gridDotsBtn}
        >
          <DotsThree size={20} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>
      <Text style={[styles.gridCardName, { color: T.textBright }]} numberOfLines={1}>
        {node.name}
      </Text>
    </TouchableOpacity>
  );

  const renderFileRow = (node: PlainTreeNode) => {
    const color = getFileColor(node.ext);
    return (
      <TouchableOpacity
        key={node.id}
        style={[styles.fileRow, { borderBottomColor: T.border }]}
        onPress={() => router.push(`/files/${node.id}` as any)}
        onLongPress={() =>
          setSheetItem({ id: node.id, name: node.name, isFolder: false, ext: node.ext })
        }
        activeOpacity={0.8}
      >
        <View style={[styles.fileIcon, { backgroundColor: color + "18" }]}>
          <Text style={[styles.fileExt, { color }]}>{node.ext.toUpperCase() || "FILE"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: T.textBright }]} numberOfLines={1}>
            {node.name}
          </Text>
          <Text style={[styles.itemMeta, { color: T.textDim }]}>{node.size ?? ""}</Text>
        </View>
        <TouchableOpacity
          onPress={() =>
            setSheetItem({ id: node.id, name: node.name, isFolder: false, ext: node.ext })
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <DotsThree size={22} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderFileGrid = (node: PlainTreeNode) => {
    const color = getFileColor(node.ext);
    return (
      <TouchableOpacity
        key={node.id}
        style={[styles.gridCard, { backgroundColor: T.surface, borderColor: T.border }]}
        onPress={() => router.push(`/files/${node.id}` as any)}
        onLongPress={() =>
          setSheetItem({ id: node.id, name: node.name, isFolder: false, ext: node.ext })
        }
        activeOpacity={0.8}
      >
        <View style={styles.gridCardTop}>
          <View style={[styles.gridFileIcon, { backgroundColor: color + "18" }]}>
            <Text style={[styles.fileExt, { color }]}>{node.ext.toUpperCase() || "FILE"}</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              setSheetItem({ id: node.id, name: node.name, isFolder: false, ext: node.ext })
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.gridDotsBtn}
          >
            <DotsThree size={20} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>
        <Text style={[styles.gridCardName, { color: T.textBright }]} numberOfLines={2}>
          {node.name}
        </Text>
        <Text style={[styles.gridCardMeta, { color: T.textDim }]}>{node.size ?? ""}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={currentFolderName}
        color={T.domains.files}
        icon="files"
        onBack={folderStack.length > 0 ? navigateBack : undefined}
        rightActions={
          <>
            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MagnifyingGlass size={19} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setAddSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Plus size={21} color={T.accent} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      {/* Sort bar */}
      <View style={[styles.sortBar, { borderBottomColor: T.border }]}>
        <TouchableOpacity style={styles.sortBtn} activeOpacity={0.7}>
          <Text style={[styles.sortText, { color: T.textDim }]}>Last modified</Text>
          <SortAscending size={14} color={T.textDim} weight="duotone" />
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

      {uploadFile.isPending && (
        <View
          style={[styles.uploadBar, { backgroundColor: T.surface, borderBottomColor: T.border }]}
        >
          <ActivityIndicator size="small" color={T.domains.files} />
          <Text style={[styles.uploadText, { color: T.text }]}>
            Uploading{uploadFile.progress > 0 ? ` ${uploadFile.progress}%` : "..."}
          </Text>
        </View>
      )}

      {filesTree.isLoading && !filesTree.data && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.domains.files} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={filesTree.isFetching && !filesTree.isLoading}
            onRefresh={() => filesTree.refetch()}
            tintColor={T.domains.files}
            colors={[T.domains.files]}
          />
        }
      >
        {currentChildren.length > 0 ? (
          gridMode ? (
            <View style={styles.gridContent}>
              {folders.length > 0 && (
                <View style={styles.gridWrap}>{folders.map(renderFolderGrid)}</View>
              )}
              {files.length > 0 && <View style={styles.gridWrap}>{files.map(renderFileGrid)}</View>}
            </View>
          ) : (
            <View style={styles.listContent}>
              {folders.map(renderFolderRow)}
              {files.map(renderFileRow)}
            </View>
          )
        ) : (
          !filesTree.isLoading && <EmptyState isSubfolder={folderStack.length > 0} />
        )}
      </ScrollView>

      {/* Add/Create action sheet (+ button) */}
      <ActionSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title={currentFolderName === "Files" ? "Add to Files" : `In "${currentFolderName}"`}
        actions={[
          { icon: "upload", label: "Upload a file", onPress: handleUpload },
          {
            icon: "folder-plus",
            label: "Create folder",
            onPress: () => {
              setAddSheetOpen(false);
              setNewFolderName("");
              setCreateFolderVisible(true);
            },
          },
          {
            icon: "camera",
            label: "Take a photo",
            onPress: () => {
              setAddSheetOpen(false);
            },
          },
        ]}
      />

      {/* Create folder modal */}
      <Modal
        visible={createFolderVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateFolderVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <Text style={[styles.modalTitle, { color: T.textBright }]}>New Folder</Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: T.pageBg, color: T.textBright, borderColor: T.border },
              ]}
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="Folder name"
              placeholderTextColor={T.textDim}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                const name = newFolderName.trim();
                if (!name) return;
                createFolder.mutate(
                  { name, parentId: currentFolderId ?? undefined },
                  { onSettled: () => setCreateFolderVisible(false) },
                );
              }}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: T.pageBg }]}
                onPress={() => setCreateFolderVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: T.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: T.domains.files, opacity: newFolderName.trim() ? 1 : 0.4 },
                ]}
                disabled={!newFolderName.trim() || createFolder.isPending}
                onPress={() => {
                  const name = newFolderName.trim();
                  if (!name) return;
                  createFolder.mutate(
                    { name, parentId: currentFolderId ?? undefined },
                    { onSettled: () => setCreateFolderVisible(false) },
                  );
                }}
              >
                {createFolder.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rename modal */}
      <Modal
        visible={!!renameTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <Text style={[styles.modalTitle, { color: T.textBright }]}>
              {renameTarget?.isFolder ? "Rename Folder" : "Rename File"}
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: T.pageBg, color: T.textBright, borderColor: T.border },
              ]}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Name"
              placeholderTextColor={T.textDim}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitRename}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: T.pageBg }]}
                onPress={() => setRenameTarget(null)}
              >
                <Text style={[styles.modalBtnText, { color: T.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: T.domains.files, opacity: renameValue.trim() ? 1 : 0.4 },
                ]}
                disabled={!renameValue.trim() || updateFile.isPending || updateFolder.isPending}
                onPress={submitRename}
              >
                {updateFile.isPending || updateFolder.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Rename</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Move-to-folder modal */}
      <Modal
        visible={!!moveTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveTarget(null)}
      >
        <TouchableOpacity
          style={styles.moveBackdrop}
          activeOpacity={1}
          onPress={() => setMoveTarget(null)}
        >
          <View />
        </TouchableOpacity>
        <View style={[styles.moveSheet, { backgroundColor: T.surface }]}>
          <View style={[styles.handle, { backgroundColor: T.border }]} />
          <Text style={[styles.moveTitle, { color: T.textBright }]}>
            Move &ldquo;{moveTarget?.name}&rdquo; to
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <TouchableOpacity
              style={[styles.moveRow, { borderBottomColor: T.border }]}
              onPress={() => doMove(undefined)}
              activeOpacity={0.7}
            >
              <FolderSimple size={20} color={T.domains.files} weight="fill" />
              <Text style={[styles.moveRowText, { color: T.textBright }]}>Files (root)</Text>
            </TouchableOpacity>
            {flattenFolders(
              filesTree.data ?? [],
              moveTarget?.isFolder ? moveTarget.id : undefined,
            ).map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.moveRow,
                  { borderBottomColor: T.border, paddingLeft: 16 + opt.depth * 18 },
                ]}
                onPress={() => doMove(opt.id)}
                activeOpacity={0.7}
              >
                <FolderSimple size={20} color={T.domains.files} weight="fill" />
                <Text style={[styles.moveRowText, { color: T.textBright }]} numberOfLines={1}>
                  {opt.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Item action sheet (dots menu / long press) */}
      <ActionSheet
        visible={!!sheetItem}
        onClose={() => setSheetItem(null)}
        title={sheetItem?.name ?? ""}
        icon="files"
        iconColor={
          sheetItem?.isFolder
            ? T.domains.files
            : sheetItem?.ext
              ? getFileColor(sheetItem.ext)
              : T.domains.files
        }
        actions={
          sheetItem?.isFolder
            ? [
                {
                  icon: "edit-2",
                  label: "Rename folder",
                  onPress: () => sheetItem && startRename(sheetItem),
                },
                {
                  icon: "folder",
                  label: "Move to folder",
                  onPress: () => {
                    if (sheetItem) {
                      const it = sheetItem;
                      setSheetItem(null);
                      setMoveTarget(it);
                    }
                  },
                },
                {
                  icon: "at-sign",
                  label: "Copy reference link",
                  onPress: () => sheetItem && copyReferenceLink(sheetItem),
                },
                {
                  icon: "trash-2",
                  label: "Delete folder",
                  isDanger: true,
                  onPress: () => {
                    if (sheetItem) {
                      deleteFolder.mutate(sheetItem.id);
                      setSheetItem(null);
                    }
                  },
                },
              ]
            : [
                {
                  icon: "external-link",
                  label: "Open file",
                  onPress: () => {
                    const id = sheetItem?.id;
                    setSheetItem(null);
                    router.push(`/files/${id}` as any);
                  },
                },
                {
                  icon: "edit-2",
                  label: "Rename file",
                  onPress: () => sheetItem && startRename(sheetItem),
                },
                {
                  icon: "folder",
                  label: "Move to folder",
                  onPress: () => {
                    if (sheetItem) {
                      const it = sheetItem;
                      setSheetItem(null);
                      setMoveTarget(it);
                    }
                  },
                },
                {
                  icon: "at-sign",
                  label: "Copy reference link",
                  onPress: () => sheetItem && copyReferenceLink(sheetItem),
                },
                {
                  icon: "trash-2",
                  label: "Delete file",
                  isDanger: true,
                  onPress: () => {
                    if (sheetItem) {
                      deleteFile.mutate(sheetItem.id);
                      setSheetItem(null);
                    }
                  },
                },
              ]
        }
      />
    </View>
  );
}

function EmptyState({ isSubfolder }: { isSubfolder: boolean }) {
  const T = useTheme();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.domains.filesSoft }]}>
        <FolderSimple size={36} color={T.domains.files} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>
        {isSubfolder ? "This folder is empty" : "No files yet"}
      </Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        {isSubfolder
          ? "Upload files or create folders here"
          : "Upload your first file to get started"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  sortBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sortText: { fontSize: 13, fontFamily: FONT.medium },
  listContent: { paddingHorizontal: 16 },
  gridContent: { padding: 16, gap: 16 },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  // ---- Folder row (list mode) ----
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
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
  // ---- File row (list mode) ----
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  fileExt: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.5 },
  itemName: { fontSize: 15, fontFamily: FONT.semibold },
  itemMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 3 },
  // ---- Grid cards ----
  gridCard: {
    width: "47%",
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  gridCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    minHeight: 44,
  },
  gridDotsBtn: { marginTop: -2 },
  gridFileIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  gridCardName: { fontSize: 13, fontFamily: FONT.semibold, lineHeight: 18 },
  gridCardMeta: { fontSize: 11, fontFamily: FONT.regular },
  // ---- Empty ----
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: 32,
  },
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
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  uploadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  uploadText: { fontSize: 13, fontFamily: FONT.medium },
  // ---- Create folder modal ----
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modalCard: {
    width: "100%",
    borderRadius: 16,
    padding: 24,
    gap: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontFamily: FONT.bold },
  modalInput: {
    fontSize: 15,
    fontFamily: FONT.regular,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  moveBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  moveSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 28,
    maxHeight: "70%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  moveTitle: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  moveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moveRowText: { fontSize: 15, fontFamily: FONT.medium, flex: 1 },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  modalBtnText: { fontSize: 14, fontFamily: FONT.semibold },
});
