import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { DotsThree, FolderSimple, Trash } from "phosphor-react-native";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FILE_COLORS } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useFilesTrash } from "@features/files/useFiles";
import {
  useRestoreFile,
  useRestoreFolder,
  useBulkDelete,
  useEmptyTrash,
} from "@features/files/useFileMutations";

function getFileColor(ext: string) {
  return FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
}

type TrashSheetItem = { id: string; name: string; isFolder: boolean } | null;

export default function FilesTrashScreen() {
  const T = useTheme();
  const trash = useFilesTrash();
  const restoreFile = useRestoreFile();
  const restoreFolder = useRestoreFolder();
  const bulkDelete = useBulkDelete();
  const emptyTrash = useEmptyTrash();
  const [sheetItem, setSheetItem] = useState<TrashSheetItem>(null);

  const files = trash.data?.files ?? [];
  const folders = trash.data?.folders ?? [];
  const isEmpty = files.length === 0 && folders.length === 0;

  const restore = (item: NonNullable<TrashSheetItem>) => {
    if (item.isFolder) restoreFolder.mutate(item.id);
    else restoreFile.mutate(item.id);
  };

  const deletePermanently = (item: NonNullable<TrashSheetItem>) => {
    Alert.alert(
      "Delete permanently",
      `"${item.name}" will be deleted forever. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            bulkDelete.mutate({
              fileIds: item.isFolder ? [] : [item.id],
              folderIds: item.isFolder ? [item.id] : [],
              permanent: true,
            }),
        },
      ],
    );
  };

  const confirmEmpty = () => {
    Alert.alert(
      "Empty trash",
      "Permanently delete everything in the trash? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Empty trash", style: "destructive", onPress: () => emptyTrash.mutate() },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Trash"
        color={T.domains.files}
        icon="files"
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

      {trash.isLoading && !trash.data && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.domains.files} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={trash.isFetching && !trash.isLoading}
            onRefresh={() => trash.refetch()}
            tintColor={T.domains.files}
            colors={[T.domains.files]}
          />
        }
      >
        {!isEmpty ? (
          <View style={styles.listContent}>
            {folders.map((folder) => (
              <View key={folder.id} style={[styles.row, { borderBottomColor: T.border }]}>
                <View style={[styles.folderIcon, { backgroundColor: T.domains.filesSoft }]}>
                  <FolderSimple size={22} color={T.domains.files} weight="fill" />
                </View>
                <Text style={[styles.itemName, { color: T.textBright }]} numberOfLines={1}>
                  {folder.name}
                </Text>
                <TouchableOpacity
                  onPress={() => setSheetItem({ id: folder.id, name: folder.name, isFolder: true })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <DotsThree size={22} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              </View>
            ))}
            {files.map((file) => {
              const color = getFileColor(file.ext);
              return (
                <View key={file.id} style={[styles.row, { borderBottomColor: T.border }]}>
                  <View style={[styles.fileIcon, { backgroundColor: color + "18" }]}>
                    <Text style={[styles.fileExt, { color }]}>
                      {file.ext.toUpperCase() || "FILE"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, { color: T.textBright }]} numberOfLines={1}>
                      {file.filename}
                    </Text>
                    <Text style={[styles.itemMeta, { color: T.textDim }]}>{file.size}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      setSheetItem({ id: file.id, name: file.filename, isFolder: false })
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <DotsThree size={22} color={T.textDim} weight="bold" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : (
          !trash.isLoading && (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: T.domains.filesSoft }]}>
                <Trash size={32} color={T.domains.files} weight="duotone" />
              </View>
              <Text style={[styles.emptyTitle, { color: T.textBright }]}>Trash is empty</Text>
              <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
                Deleted files and folders show up here
              </Text>
            </View>
          )
        )}
      </ScrollView>

      <ActionSheet
        visible={!!sheetItem}
        onClose={() => setSheetItem(null)}
        title={sheetItem?.name ?? ""}
        icon="files"
        iconColor={T.domains.files}
        actions={[
          {
            icon: "repeat",
            label: sheetItem?.isFolder ? "Restore folder" : "Restore file",
            onPress: () => sheetItem && restore(sheetItem),
          },
          {
            icon: "trash-2",
            label: "Delete permanently",
            isDanger: true,
            onPress: () => sheetItem && deletePermanently(sheetItem),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  listContent: { paddingHorizontal: 16 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  fileExt: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.5 },
  itemName: { fontSize: 15, fontFamily: FONT.semibold, flex: 1 },
  itemMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 3 },
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
