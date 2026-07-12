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
  BackHandler,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  MagnifyingGlass,
  Plus,
  DotsThree,
  FolderSimple,
  SquaresFour,
  Rows,
  X,
  SortAscending,
  SortDescending,
  CheckCircle,
  FolderOpen,
  DownloadSimple,
  Trash,
} from "phosphor-react-native";
import { router, useFocusEffect } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { FileThumb } from "@/components/FileThumb";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/context/auth-context";
import { FILE_COLORS } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import { useFilesTree, useStorageUsage } from "@/hooks/useFiles";
import { useToggleBookmark } from "@/hooks/useBookmarks";
import type { PlainTreeNode } from "@/lib/fileSerializer";
import {
  useDeleteFile,
  useDeleteFolder,
  useCreateFolder,
  useUploadFile,
  useUpdateFile,
  useUpdateFolder,
  useMoveItems,
  useBulkDelete,
} from "@/hooks/useFileMutations";
import { useFileDownload } from "@/hooks/useFileDownload";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

type SortKey = "name" | "size";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = { name: "Name", size: "Size" };

function sortNodes(nodes: PlainTreeNode[], key: SortKey, dir: SortDir): PlainTreeNode[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (key === "size") return (a.sizeBytes - b.sizeBytes) * factor;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * factor;
  });
}

function getFileColor(ext: string) {
  return FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
}

type FolderOption = { id: string; name: string; depth: number };

// Flat list of folders for the move picker. Skips any subtree rooted at an id
// in `excludeIds` so a folder can never be moved into itself or a descendant.
function flattenFolders(
  nodes: PlainTreeNode[],
  excludeIds: Set<string>,
  depth = 0,
): FolderOption[] {
  const out: FolderOption[] = [];
  for (const node of nodes) {
    if (!node.isFolder || excludeIds.has(node.id)) continue;
    out.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      out.push(...flattenFolders(node.children, excludeIds, depth + 1));
    }
  }
  return out;
}

type SheetItem = {
  id: string;
  name: string;
  isFolder: boolean;
  ext?: string;
  mimeType?: string;
} | null;

export default function FilesListScreen() {
  const T = useTheme();
  const { organizationId } = useAuth();
  const [scope, setScope] = useState<"all" | "personal">("all");
  const filesTree = useFilesTree(scope === "personal");
  const storage = useStorageUsage();
  const toggleBookmark = useToggleBookmark();
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
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const createFolder = useCreateFolder();
  const uploadFile = useUploadFile();
  const updateFile = useUpdateFile();
  const updateFolder = useUpdateFolder();
  const moveItems = useMoveItems();
  const bulkDelete = useBulkDelete();
  const download = useFileDownload();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterSelect = useCallback((id: string) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

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

  const bookmarkItem = useCallback(
    (item: NonNullable<SheetItem>) => {
      const type = item.isFolder ? "FOLDER" : "FILE";
      toggleBookmark.mutate(`urn:uniffy:content:${type}:${item.id}`);
    },
    [toggleBookmark],
  );
  // Folder navigation stack: array of { id, name } for breadcrumb
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);

  // Switching scope changes the underlying tree, so drop navigation + selection
  // that referenced the previous scope's folders.
  const changeScope = useCallback((next: "all" | "personal") => {
    setScope(next);
    setFolderStack([]);
    setSelectMode(false);
    setSelected(new Set());
  }, []);

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

  const query = searchQuery.trim().toLowerCase();
  const visibleChildren = useMemo(
    () =>
      query ? currentChildren.filter((n) => n.name.toLowerCase().includes(query)) : currentChildren,
    [currentChildren, query],
  );

  const folders = useMemo(
    () =>
      sortNodes(
        visibleChildren.filter((n) => n.isFolder),
        sortKey,
        sortDir,
      ),
    [visibleChildren, sortKey, sortDir],
  );
  const files = useMemo(
    () =>
      sortNodes(
        visibleChildren.filter((n) => !n.isFolder),
        sortKey,
        sortDir,
      ),
    [visibleChildren, sortKey, sortDir],
  );

  const selectedFileIds = useMemo(
    () => files.filter((f) => selected.has(f.id)).map((f) => f.id),
    [files, selected],
  );
  const selectedFolderIds = useMemo(
    () => folders.filter((f) => selected.has(f.id)).map((f) => f.id),
    [folders, selected],
  );

  const doBulkMove = useCallback(
    (targetFolderId: string | undefined) => {
      moveItems.mutate(
        { fileIds: selectedFileIds, folderIds: selectedFolderIds, targetFolderId },
        {
          onSettled: () => {
            setBulkMoveOpen(false);
            exitSelect();
          },
        },
      );
    },
    [moveItems, selectedFileIds, selectedFolderIds, exitSelect],
  );

  const doBulkDelete = useCallback(() => {
    const count = selected.size;
    Alert.alert("Move to trash", `Move ${count} ${count === 1 ? "item" : "items"} to the trash?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          bulkDelete.mutate(
            { fileIds: selectedFileIds, folderIds: selectedFolderIds },
            { onSettled: exitSelect },
          ),
      },
    ]);
  }, [bulkDelete, selected, selectedFileIds, selectedFolderIds, exitSelect]);

  const doBulkDownload = useCallback(async () => {
    const targets = files.filter((f) => selected.has(f.id));
    exitSelect();
    // No batch save on mobile; write each file to the device in turn (the SAF
    // folder grant is remembered after the first, so it only prompts once).
    for (const f of targets) {
      await download.saveToDevice(f.id, f.name, f.mimeType);
    }
  }, [files, selected, download, exitSelect]);

  const allVisibleSelected =
    visibleChildren.length > 0 && visibleChildren.every((n) => selected.has(n.id));
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      visibleChildren.every((n) => prev.has(n.id))
        ? new Set()
        : new Set(visibleChildren.map((n) => n.id)),
    );
  }, [visibleChildren]);

  const closeMove = useCallback(() => {
    setMoveTarget(null);
    setBulkMoveOpen(false);
  }, []);
  const moveTitle = bulkMoveOpen
    ? `Move ${selected.size} ${selected.size === 1 ? "item" : "items"} to`
    : `Move "${moveTarget?.name ?? ""}" to`;
  const moveExcludeIds = useMemo(
    () =>
      bulkMoveOpen
        ? new Set(selectedFolderIds)
        : new Set(moveTarget?.isFolder ? [moveTarget.id] : []),
    [bulkMoveOpen, selectedFolderIds, moveTarget],
  );
  const onPickMoveTarget = (targetFolderId?: string) =>
    bulkMoveOpen ? doBulkMove(targetFolderId) : doMove(targetFolderId);

  const navigateIntoFolder = useCallback((node: PlainTreeNode) => {
    setFolderStack((prev) => [...prev, { id: node.id, name: node.name }]);
  }, []);

  const navigateBack = useCallback(() => {
    setFolderStack((prev) => prev.slice(0, -1));
  }, []);

  // Android hardware back: unwind selection / folder navigation before letting
  // the default handler pop the route (which would leave the Files domain).
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (selectMode) {
          exitSelect();
          return true;
        }
        if (folderStack.length > 0) {
          navigateBack();
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
      return () => sub.remove();
    }, [selectMode, folderStack.length, exitSelect, navigateBack]),
  );

  const handleUpload = useCallback(async () => {
    setAddSheetOpen(false);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    // Mobile OS pickers cannot select a folder tree (no webkitdirectory
    // equivalent), so multi-select is the closest thing to the web's folder
    // upload. Upload sequentially so the single progress bar stays meaningful.
    for (const asset of result.assets) {
      await uploadFile.mutateAsync({
        uri: asset.uri,
        filename: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 0,
        folderId: currentFolderId ?? undefined,
      });
    }
  }, [currentFolderId, uploadFile]);

  const handleTakePhoto = useCallback(async () => {
    setAddSheetOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera access needed", "Enable camera access in Settings to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    uploadFile.mutate({
      uri: asset.uri,
      filename: asset.fileName ?? `Photo_${stamp}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
      size: asset.fileSize ?? 0,
      folderId: currentFolderId ?? undefined,
    });
  }, [currentFolderId, uploadFile]);

  // ---- Renderers ----

  const SelectDot = ({ on }: { on: boolean }) =>
    on ? (
      <CheckCircle size={22} color={T.accent} weight="fill" />
    ) : (
      <View style={[styles.selectDotOff, { borderColor: T.textDim }]} />
    );

  const renderFolderRow = (node: PlainTreeNode) => {
    const isSel = selected.has(node.id);
    return (
      <TouchableOpacity
        key={node.id}
        style={[
          styles.folderRow,
          { borderBottomColor: T.border },
          isSel && { backgroundColor: T.accentSoft },
        ]}
        onPress={() => (selectMode ? toggleSelect(node.id) : navigateIntoFolder(node))}
        onLongPress={() => enterSelect(node.id)}
        activeOpacity={0.7}
      >
        {selectMode && <SelectDot on={isSel} />}
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
        {!selectMode && (
          <TouchableOpacity
            onPress={() => setSheetItem({ id: node.id, name: node.name, isFolder: true })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <DotsThree size={22} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderFolderGrid = (node: PlainTreeNode) => {
    const isSel = selected.has(node.id);
    return (
      <TouchableOpacity
        key={node.id}
        style={[
          styles.gridCard,
          { backgroundColor: T.surface, borderColor: isSel ? T.accent : T.border },
        ]}
        onPress={() => (selectMode ? toggleSelect(node.id) : navigateIntoFolder(node))}
        onLongPress={() => enterSelect(node.id)}
        activeOpacity={0.7}
      >
        <View style={styles.gridCardTop}>
          <FolderSimple size={40} color={T.domains.files} weight="fill" />
          {selectMode ? (
            <SelectDot on={isSel} />
          ) : (
            <TouchableOpacity
              onPress={() => setSheetItem({ id: node.id, name: node.name, isFolder: true })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.gridDotsBtn}
            >
              <DotsThree size={20} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={[styles.gridCardName, { color: T.textBright }]} numberOfLines={1}>
          {node.name}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderFileRow = (node: PlainTreeNode) => {
    const isSel = selected.has(node.id);
    const openSheet = () =>
      setSheetItem({
        id: node.id,
        name: node.name,
        isFolder: false,
        ext: node.ext,
        mimeType: node.mimeType,
      });
    return (
      <TouchableOpacity
        key={node.id}
        style={[
          styles.fileRow,
          { borderBottomColor: T.border },
          isSel && { backgroundColor: T.accentSoft },
        ]}
        onPress={() =>
          selectMode ? toggleSelect(node.id) : router.push(`/files/${node.id}` as any)
        }
        onLongPress={() => enterSelect(node.id)}
        activeOpacity={0.8}
      >
        {selectMode && <SelectDot on={isSel} />}
        <FileThumb
          fileId={node.id}
          organizationId={organizationId}
          mimeType={node.mimeType}
          ext={node.ext}
          style={styles.fileIcon}
          radius={12}
          textSize={10}
          refreshKey={filesTree.dataUpdatedAt}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: T.textBright }]} numberOfLines={1}>
            {node.name}
          </Text>
          <Text style={[styles.itemMeta, { color: T.textDim }]}>{node.size ?? ""}</Text>
        </View>
        {!selectMode && (
          <TouchableOpacity onPress={openSheet} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <DotsThree size={22} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderFileGrid = (node: PlainTreeNode) => {
    const isSel = selected.has(node.id);
    return (
      <TouchableOpacity
        key={node.id}
        style={[
          styles.gridFileCard,
          { backgroundColor: T.surface, borderColor: isSel ? T.accent : T.border },
        ]}
        onPress={() =>
          selectMode ? toggleSelect(node.id) : router.push(`/files/${node.id}` as any)
        }
        onLongPress={() => enterSelect(node.id)}
        activeOpacity={0.8}
      >
        <View style={[styles.gridPreview, { backgroundColor: T.pageBg }]}>
          <FileThumb
            fileId={node.id}
            organizationId={organizationId}
            mimeType={node.mimeType}
            ext={node.ext}
            style={StyleSheet.absoluteFill}
            radius={0}
            textSize={18}
            refreshKey={filesTree.dataUpdatedAt}
          />
          {selectMode ? (
            <View style={styles.gridOverlayLeft}>
              <SelectDot on={isSel} />
            </View>
          ) : (
            <TouchableOpacity
              onPress={() =>
                setSheetItem({
                  id: node.id,
                  name: node.name,
                  isFolder: false,
                  ext: node.ext,
                  mimeType: node.mimeType,
                })
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.gridOverlayRight, { backgroundColor: T.surface }]}
            >
              <DotsThree size={18} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.gridInfo}>
          <Text style={[styles.gridCardName, { color: T.textBright }]} numberOfLines={2}>
            {node.name}
          </Text>
          <Text style={[styles.gridCardMeta, { color: T.textDim }]}>{node.size ?? ""}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={selectMode ? `${selected.size} selected` : currentFolderName}
        subtitle={!selectMode && scope === "personal" ? "My files only" : undefined}
        color={T.domains.files}
        icon="files"
        onBack={selectMode ? exitSelect : folderStack.length > 0 ? navigateBack : undefined}
        rightActions={
          selectMode ? (
            <TouchableOpacity
              onPress={toggleSelectAll}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.selectAllText, { color: T.accent }]}>
                {allVisibleSelected ? "None" : "All"}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => {
                  setSearchOpen((v) => {
                    if (v) setSearchQuery("");
                    return !v;
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MagnifyingGlass size={19} color={searchOpen ? T.accent : T.text} weight="bold" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMenuOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <DotsThree size={22} color={T.text} weight="bold" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setAddSheetOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Plus size={21} color={T.accent} weight="bold" />
              </TouchableOpacity>
            </>
          )
        }
      />

      {!selectMode && searchOpen && (
        <View
          style={[styles.searchBar, { backgroundColor: T.surface, borderBottomColor: T.border }]}
        >
          <MagnifyingGlass size={16} color={T.textDim} weight="bold" />
          <TextInput
            style={[styles.searchInput, { color: T.textBright }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Search in ${currentFolderName}`}
            placeholderTextColor={T.textDim}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={16} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {selectMode ? (
        <View style={[styles.bulkBar, { backgroundColor: T.surface, borderBottomColor: T.border }]}>
          <BulkAction
            icon={<FolderOpen size={20} color={T.text} weight="duotone" />}
            label="Move"
            disabled={selected.size === 0}
            onPress={() => setBulkMoveOpen(true)}
          />
          <BulkAction
            icon={<DownloadSimple size={20} color={T.text} weight="duotone" />}
            label="Download"
            disabled={selectedFileIds.length === 0}
            onPress={doBulkDownload}
          />
          <BulkAction
            icon={<Trash size={20} color="#FA5252" weight="duotone" />}
            label="Delete"
            danger
            disabled={selected.size === 0}
            onPress={doBulkDelete}
          />
        </View>
      ) : (
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
      )}

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
        {visibleChildren.length > 0 ? (
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
        ) : query ? (
          <NoResults query={searchQuery.trim()} />
        ) : (
          !filesTree.isLoading && <EmptyState isSubfolder={folderStack.length > 0} />
        )}

        {!selectMode && folderStack.length === 0 && storage.data && (
          <StorageBar
            used={storage.data.used}
            quota={storage.data.quota}
            percent={storage.data.usagePercent}
          />
        )}
      </ScrollView>

      {/* Add/Create action sheet (+ button) */}
      <ActionSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title={currentFolderName === "Files" ? "Add to Files" : `In "${currentFolderName}"`}
        actions={[
          { icon: "upload", label: "Upload files", onPress: handleUpload },
          {
            icon: "folder-plus",
            label: "Create folder",
            onPress: () => {
              setAddSheetOpen(false);
              setNewFolderName("");
              setCreateFolderVisible(true);
            },
          },
          { icon: "camera", label: "Take a photo", onPress: handleTakePhoto },
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

      {/* Move-to-folder modal (single item or bulk selection) */}
      <Modal
        visible={!!moveTarget || bulkMoveOpen}
        transparent
        animationType="slide"
        onRequestClose={closeMove}
      >
        <TouchableOpacity style={styles.moveBackdrop} activeOpacity={1} onPress={closeMove}>
          <View />
        </TouchableOpacity>
        <View style={[styles.moveSheet, { backgroundColor: T.surface }]}>
          <View style={[styles.handle, { backgroundColor: T.border }]} />
          <Text style={[styles.moveTitle, { color: T.textBright }]}>{moveTitle}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <TouchableOpacity
              style={[styles.moveRow, { borderBottomColor: T.border }]}
              onPress={() => onPickMoveTarget(undefined)}
              activeOpacity={0.7}
            >
              <FolderSimple size={20} color={T.domains.files} weight="fill" />
              <Text style={[styles.moveRowText, { color: T.textBright }]}>Files (root)</Text>
            </TouchableOpacity>
            {flattenFolders(filesTree.data ?? [], moveExcludeIds).map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.moveRow,
                  { borderBottomColor: T.border, paddingLeft: 16 + opt.depth * 18 },
                ]}
                onPress={() => onPickMoveTarget(opt.id)}
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
                  icon: "bookmark",
                  label: "Bookmark",
                  onPress: () => sheetItem && bookmarkItem(sheetItem),
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
                  icon: "download",
                  label: "Save to device",
                  onPress: () => {
                    if (sheetItem)
                      download.saveToDevice(sheetItem.id, sheetItem.name, sheetItem.mimeType);
                  },
                },
                {
                  icon: "share-2",
                  label: "Share",
                  onPress: () => {
                    if (sheetItem)
                      download.saveOrShare(sheetItem.id, sheetItem.name, sheetItem.mimeType);
                  },
                },
                {
                  icon: "bookmark",
                  label: "Bookmark",
                  onPress: () => sheetItem && bookmarkItem(sheetItem),
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

      {/* Sort action sheet */}
      <ActionSheet
        visible={sortSheetOpen}
        onClose={() => setSortSheetOpen(false)}
        title="Sort by"
        actions={[
          {
            icon: "sort-asc",
            label: "Name (A–Z)",
            color: sortKey === "name" && sortDir === "asc" ? T.accent : undefined,
            onPress: () => {
              setSortKey("name");
              setSortDir("asc");
            },
          },
          {
            icon: "sort-desc",
            label: "Name (Z–A)",
            color: sortKey === "name" && sortDir === "desc" ? T.accent : undefined,
            onPress: () => {
              setSortKey("name");
              setSortDir("desc");
            },
          },
          {
            icon: "sort-asc",
            label: "Size (smallest first)",
            color: sortKey === "size" && sortDir === "asc" ? T.accent : undefined,
            onPress: () => {
              setSortKey("size");
              setSortDir("asc");
            },
          },
          {
            icon: "sort-desc",
            label: "Size (largest first)",
            color: sortKey === "size" && sortDir === "desc" ? T.accent : undefined,
            onPress: () => {
              setSortKey("size");
              setSortDir("desc");
            },
          },
        ]}
      />

      {/* Screen overflow menu */}
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Files"
        subtitle={
          storage.data
            ? storage.data.quota
              ? `${storage.data.used} of ${storage.data.quota} used`
              : `${storage.data.used} used`
            : undefined
        }
        icon="files"
        iconColor={T.domains.files}
        actions={[
          {
            icon: "grid",
            label: "All files",
            color: scope === "all" ? T.accent : undefined,
            onPress: () => changeScope("all"),
          },
          {
            icon: "lock",
            label: "My files only",
            color: scope === "personal" ? T.accent : undefined,
            onPress: () => changeScope("personal"),
          },
          {
            icon: "check-circle",
            label: "Select items",
            onPress: () => setSelectMode(true),
          },
          {
            icon: "trash-2",
            label: "Open trash",
            onPress: () => router.push("/files/trash" as any),
          },
        ]}
      />
    </View>
  );
}

function NoResults({ query }: { query: string }) {
  const T = useTheme();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.domains.filesSoft }]}>
        <MagnifyingGlass size={32} color={T.domains.files} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No matches</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Nothing here matches &ldquo;{query}&rdquo;
      </Text>
    </View>
  );
}

function StorageBar({ used, quota, percent }: { used: string; quota?: string; percent: number }) {
  const T = useTheme();
  const pct = Math.max(0, Math.min(100, percent));
  const nearFull = pct >= 90;
  return (
    <View style={styles.storageWrap}>
      <View style={styles.storageHeader}>
        <Text style={[styles.storageLabel, { color: T.textDim }]}>Storage</Text>
        <Text style={[styles.storageValue, { color: T.textDim }]}>
          {quota ? `${used} of ${quota}` : `${used} used`}
        </Text>
      </View>
      {quota ? (
        <View style={[styles.storageTrack, { backgroundColor: T.border }]}>
          <View
            style={[
              styles.storageFill,
              { backgroundColor: nearFull ? "#FA5252" : T.domains.files, width: `${pct}%` },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

function BulkAction({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const T = useTheme();
  return (
    <TouchableOpacity
      style={[styles.bulkAction, disabled && { opacity: 0.35 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {icon}
      <Text style={[styles.bulkActionLabel, { color: danger ? "#FA5252" : T.text }]}>{label}</Text>
    </TouchableOpacity>
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
  selectAllText: { fontSize: 15, fontFamily: FONT.semibold },
  bulkBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bulkAction: { alignItems: "center", gap: 4, paddingHorizontal: 20, paddingVertical: 4 },
  bulkActionLabel: { fontSize: 12, fontFamily: FONT.medium },
  selectDotOff: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  storageWrap: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8, gap: 8 },
  storageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  storageLabel: { fontSize: 12, fontFamily: FONT.semibold, letterSpacing: 0.4 },
  storageValue: { fontSize: 12, fontFamily: FONT.regular },
  storageTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  storageFill: { height: 5, borderRadius: 3 },
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
  },
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
  gridFileCard: {
    width: "47%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  gridPreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    position: "relative",
    overflow: "hidden",
  },
  gridOverlayRight: {
    position: "absolute",
    top: 6,
    right: 6,
    borderRadius: 13,
    padding: 4,
  },
  gridOverlayLeft: {
    position: "absolute",
    top: 6,
    left: 6,
  },
  gridInfo: { padding: 12, gap: 4 },
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
