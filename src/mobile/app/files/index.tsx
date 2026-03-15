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
} from "react-native";
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
import { DOMAIN_COLORS, FILE_COLORS } from "@/constants/theme";
import { useFilesTree } from "@/hooks/useFiles";
import type { PlainTreeNode } from "@/lib/fileSerializer";
import {
  useDeleteFile,
  useDeleteFolder,
  useCreateFolder,
  useUploadFile,
} from "@/hooks/useFileMutations";
import * as DocumentPicker from "expo-document-picker";

function getFileColor(ext: string) {
  return FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
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
  const createFolder = useCreateFolder();
  const uploadFile = useUploadFile();
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
      <View style={[styles.folderIcon, { backgroundColor: DOMAIN_COLORS.filesSoft }]}>
        <FolderSimple size={24} color={DOMAIN_COLORS.files} weight="fill" />
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
        <FolderSimple size={40} color={DOMAIN_COLORS.files} weight="fill" />
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
        color={DOMAIN_COLORS.files}
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
          <ActivityIndicator size="small" color={DOMAIN_COLORS.files} />
          <Text style={[styles.uploadText, { color: T.text }]}>
            Uploading{uploadFile.progress > 0 ? ` ${uploadFile.progress}%` : "..."}
          </Text>
        </View>
      )}

      {filesTree.isLoading && !filesTree.data && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.files} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={filesTree.isFetching && !filesTree.isLoading}
            onRefresh={() => filesTree.refetch()}
            tintColor={DOMAIN_COLORS.files}
            colors={[DOMAIN_COLORS.files]}
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
                  { backgroundColor: DOMAIN_COLORS.files, opacity: newFolderName.trim() ? 1 : 0.4 },
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

      {/* Item action sheet (dots menu / long press) */}
      <ActionSheet
        visible={!!sheetItem}
        onClose={() => setSheetItem(null)}
        title={sheetItem?.name ?? ""}
        icon="files"
        iconColor={
          sheetItem?.isFolder
            ? DOMAIN_COLORS.files
            : sheetItem?.ext
              ? getFileColor(sheetItem.ext)
              : DOMAIN_COLORS.files
        }
        actions={
          sheetItem?.isFolder
            ? [
                { icon: "edit-2", label: "Rename folder", onPress: () => {} },
                { icon: "share-2", label: "Share folder", onPress: () => {} },
                { icon: "download", label: "Download folder", onPress: () => {} },
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
                { icon: "download", label: "Download", onPress: () => {} },
                { icon: "at-sign", label: "Copy reference link", onPress: () => {} },
                { icon: "share-2", label: "Share with team", onPress: () => {} },
                { icon: "star", label: "Add to starred", onPress: () => {} },
                { icon: "folder", label: "Move to folder", onPress: () => {} },
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
      <View style={[styles.emptyIconWrap, { backgroundColor: DOMAIN_COLORS.filesSoft }]}>
        <FolderSimple size={36} color={DOMAIN_COLORS.files} weight="duotone" />
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
  sortText: { fontSize: 13, fontFamily: "Inter_500Medium" },
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
  fileExt: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  itemName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
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
  gridCardName: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  gridCardMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
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
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  uploadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  uploadText: { fontSize: 13, fontFamily: "Inter_500Medium" },
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
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalInput: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
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
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
