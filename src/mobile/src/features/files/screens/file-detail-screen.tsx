import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  DotsThree,
  Export,
  DownloadSimple,
  BookmarkSimple,
  PencilSimple,
  Plus,
  ArrowCounterClockwise,
} from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { FilePreview } from "@features/files/components/FilePreview";
import { TagPickerSheet } from "@features/tags/components/TagPickerSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT, FILE_COLORS } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useFile, useFileVersions } from "@features/files/useFiles";
import { useDeleteFile, useUpdateFile, useRestoreFileVersion } from "@features/files/useFileMutations";
import { useFileDownload } from "@features/files/useFileDownload";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { useAuth } from "@core/providers/auth-context";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getFileColor(ext: string) {
  return FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
}

export default function FileDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const auth = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [descValue, setDescValue] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const fileQuery = useFile(id);
  const deleteFile = useDeleteFile();
  const updateFile = useUpdateFile();
  const download = useFileDownload();
  const bookmarked = useIsBookmarked(fileQuery.data?.urn ?? "");
  const toggleBookmark = useToggleBookmark();
  const versions = useFileVersions(id, versionsOpen);
  const restoreVersion = useRestoreFileVersion();

  if (fileQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Files" color={T.accent} icon="files" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      </View>
    );
  }

  const file = fileQuery.data;
  if (!file) return null;

  const fileColor = getFileColor(file.ext);
  const uploaderName = file.ownerInfo?.name || auth.user?.fullName || "Unknown";
  const selectedTagIds = file.tagObjects.map((t) => t.id);
  const isBookmarked = bookmarked.data ?? false;

  const copyReferenceLink = async () => {
    await Clipboard.setStringAsync(`urn:uniffy:content:FILE:${file.id}`);
    Alert.alert("Copied", "Reference link copied to clipboard.");
  };

  const openDescription = () => {
    setDescValue(file.description ?? "");
    setDescOpen(true);
  };

  const saveDescription = () => {
    updateFile.mutate(
      { fileId: file.id, description: descValue.trim() },
      { onSettled: () => setDescOpen(false) },
    );
  };

  const onToggleTag = (tagId: string) => {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((t) => t !== tagId)
      : [...selectedTagIds, tagId];
    updateFile.mutate({ fileId: file.id, tagIds: next });
  };

  const details: { label: string; value: string }[] = [
    { label: "Type", value: file.mimeType || `${file.ext.toUpperCase()} file` },
    { label: "Size", value: file.size },
    { label: "Created", value: fmtDate(file.createdAt) },
    { label: "Modified", value: fmtDate(file.editedAt) },
    { label: "Version", value: `v${file.version}` },
  ];

  const meta = file.metadata;
  const metaRows: { label: string; value: string }[] = [];
  if (meta?.width && meta?.height) {
    metaRows.push({ label: "Dimensions", value: `${meta.width} × ${meta.height}` });
  }
  if (meta?.durationSeconds) {
    metaRows.push({ label: "Duration", value: fmtDuration(meta.durationSeconds) });
  }
  if (meta?.pageCount) metaRows.push({ label: "Pages", value: String(meta.pageCount) });
  if (meta?.format) metaRows.push({ label: "Format", value: meta.format });
  if (meta?.colorMode) metaRows.push({ label: "Color mode", value: meta.colorMode });
  if (meta?.sampleRate) metaRows.push({ label: "Sample rate", value: `${meta.sampleRate} Hz` });
  if (meta?.bitrate) {
    metaRows.push({ label: "Bitrate", value: `${Math.round(meta.bitrate / 1000)} kbps` });
  }
  if (meta?.channels) metaRows.push({ label: "Channels", value: String(meta.channels) });

  const exifEntries = Object.entries(meta?.exif ?? {}).slice(0, 12);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Files"
        color={T.accent}
        icon="files"
        rightActions={
          <>
            <TouchableOpacity
              onPress={() => toggleBookmark.mutate(file.urn)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <BookmarkSimple
                size={20}
                color={isBookmarked ? T.accent : T.text}
                weight={isBookmarked ? "fill" : "regular"}
              />
            </TouchableOpacity>
            <CommentButton
              contentType={ContentType.FILE}
              contentId={file.id}
              color={T.accent}
            />
            <ShareButton
              contentType={ContentType.FILE}
              contentId={file.id}
              color={T.accent}
            />
            <TouchableOpacity
              onPress={() => setSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <DotsThree size={22} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.previewCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <FilePreview
            fileId={file.id}
            filename={file.filename}
            mimeType={file.mimeType}
            ext={file.ext}
            organizationId={auth.organizationId ?? ""}
          />
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={[styles.previewBtn, { backgroundColor: T.accent }]}
              onPress={() => download.saveToDevice(file.id, file.filename, file.mimeType)}
              disabled={download.isBusy(file.id)}
            >
              {download.isBusy(file.id) ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <DownloadSimple size={14} color="#fff" weight="bold" />
              )}
              <Text style={[styles.previewBtnText, { color: "#fff" }]}>Download</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.previewBtn,
                { backgroundColor: T.surfaceHover, borderColor: T.border, borderWidth: 1 },
              ]}
              onPress={() => download.saveOrShare(file.id, file.filename, file.mimeType)}
              disabled={download.isBusy(file.id)}
            >
              <Export size={14} color={T.text} weight="duotone" />
              <Text style={[styles.previewBtnText, { color: T.text }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View>
          <Text style={[styles.fileTitle, { color: T.textBright }]}>{file.filename}</Text>
          <Text style={[styles.fileMeta, { color: T.textDim }]}>
            {file.size} · Uploaded {fmtDate(file.createdAt)}
          </Text>
        </View>

        <View style={[styles.uploaderRow, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={[styles.uploaderAvatar, { backgroundColor: T.accent + "22" }]}>
            <Text style={[styles.uploaderInitial, { color: T.accent }]}>
              {uploaderName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={[styles.uploaderName, { color: T.textBright }]}>{uploaderName}</Text>
            <Text style={[styles.uploaderMeta, { color: T.textDim }]}>Owner</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.descriptionCard, { backgroundColor: T.surface, borderColor: T.border }]}
          onPress={openDescription}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>DESCRIPTION</Text>
            <PencilSimple size={15} color={T.textDim} weight="duotone" />
          </View>
          <Text style={[styles.descriptionText, { color: file.description ? T.text : T.textDim }]}>
            {file.description || "Add a description"}
          </Text>
        </TouchableOpacity>

        <DetailCard rows={details} />

        {metaRows.length > 0 && (
          <View style={styles.metaSection}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>METADATA</Text>
            <DetailCard rows={metaRows} />
          </View>
        )}

        {exifEntries.length > 0 && (
          <View style={styles.metaSection}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>CAMERA / EXIF</Text>
            <DetailCard rows={exifEntries.map(([label, value]) => ({ label, value }))} />
          </View>
        )}

        <View style={styles.tagsSection}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>TAGS</Text>
            <TouchableOpacity
              onPress={() => setTagSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <PencilSimple size={15} color={T.textDim} weight="duotone" />
            </TouchableOpacity>
          </View>
          <View style={styles.tagsRow}>
            {file.tagObjects.map((tag) => (
              <View key={tag.id} style={[styles.tag, { backgroundColor: tag.color + "22" }]}>
                <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.tagAdd, { borderColor: T.border }]}
              onPress={() => setTagSheetOpen(true)}
            >
              <Plus size={12} color={T.textDim} weight="bold" />
              <Text style={[styles.tagAddText, { color: T.textDim }]}>Add tag</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={file.filename}
        subtitle={`${file.size} · v${file.version}`}
        icon="files"
        iconColor={fileColor}
        actions={[
          {
            icon: "download",
            label: "Save to device",
            onPress: () => download.saveToDevice(file.id, file.filename, file.mimeType),
          },
          {
            icon: "share-2",
            label: "Share",
            onPress: () => download.saveOrShare(file.id, file.filename, file.mimeType),
          },
          { icon: "edit-2", label: "Edit description", onPress: openDescription },
          { icon: "tag", label: "Edit tags", onPress: () => setTagSheetOpen(true) },
          {
            icon: "clock-history",
            label: "Version history",
            onPress: () => setVersionsOpen(true),
          },
          { icon: "at-sign", label: "Copy reference link", onPress: copyReferenceLink },
          {
            icon: "trash-2",
            label: "Delete file",
            isDanger: true,
            onPress: () => {
              deleteFile.mutate(file.id);
              setSheetOpen(false);
              router.back();
            },
          },
        ]}
      />

      <TagPickerSheet
        visible={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        selectedIds={selectedTagIds}
        onToggle={onToggleTag}
        busy={updateFile.isPending}
      />

      <DescriptionModal
        visible={descOpen}
        value={descValue}
        onChange={setDescValue}
        onCancel={() => setDescOpen(false)}
        onSave={saveDescription}
        saving={updateFile.isPending}
      />

      <VersionsModal
        visible={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        loading={versions.isLoading}
        versions={versions.data ?? []}
        currentVersion={file.version}
        onRestore={(versionId) =>
          restoreVersion.mutate(
            { fileId: file.id, versionId },
            { onSettled: () => setVersionsOpen(false) },
          )
        }
        restoring={restoreVersion.isPending}
      />
    </View>
  );
}

function DetailCard({ rows }: { rows: { label: string; value: string }[] }) {
  const T = useTheme();
  return (
    <View style={[styles.detailsCard, { backgroundColor: T.surface, borderColor: T.border }]}>
      {rows.map((d, i) => (
        <View
          key={d.label}
          style={[
            styles.detailRow,
            {
              borderBottomColor: T.border,
              borderBottomWidth: i < rows.length - 1 ? StyleSheet.hairlineWidth : 0,
            },
          ]}
        >
          <Text style={[styles.detailLabel, { color: T.textDim }]}>{d.label}</Text>
          <Text style={[styles.detailValue, { color: T.textBright }]} numberOfLines={1}>
            {d.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DescriptionModal({
  visible,
  value,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  visible: boolean;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const T = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalOverlay}
      >
        <View style={[styles.modalCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <Text style={[styles.modalTitle, { color: T.textBright }]}>Description</Text>
          <TextInput
            style={[
              styles.modalInput,
              { backgroundColor: T.pageBg, color: T.textBright, borderColor: T.border },
            ]}
            value={value}
            onChangeText={onChange}
            placeholder="Describe this file"
            placeholderTextColor={T.textDim}
            multiline
            autoFocus
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: T.pageBg }]}
              onPress={onCancel}
            >
              <Text style={[styles.modalBtnText, { color: T.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: T.accent }]}
              onPress={onSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function VersionsModal({
  visible,
  onClose,
  loading,
  versions,
  currentVersion,
  onRestore,
  restoring,
}: {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  versions: { id: string; versionNumber: number; size: string; createdAt: string }[];
  currentVersion: number;
  onRestore: (versionId: string) => void;
  restoring: boolean;
}) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.moveBackdrop} activeOpacity={1} onPress={onClose}>
        <View />
      </TouchableOpacity>
      <View
        style={[styles.versionsSheet, { backgroundColor: T.surface, paddingBottom: bottomPad + 8 }]}
      >
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <Text style={[styles.moveTitle, { color: T.textBright }]}>Version history</Text>
        {loading ? (
          <View style={{ padding: 24 }}>
            <ActivityIndicator size="small" color={T.accent} />
          </View>
        ) : versions.length === 0 ? (
          <Text style={[styles.versionEmpty, { color: T.textDim }]}>No previous versions</Text>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {versions.map((v) => {
              const isCurrent = v.versionNumber === currentVersion;
              return (
                <View key={v.id} style={[styles.versionRow, { borderBottomColor: T.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.versionName, { color: T.textBright }]}>
                      Version {v.versionNumber}
                      {isCurrent ? " (current)" : ""}
                    </Text>
                    <Text style={[styles.versionMeta, { color: T.textDim }]}>
                      {v.size} · {fmtDate(v.createdAt)}
                    </Text>
                  </View>
                  {!isCurrent && (
                    <TouchableOpacity
                      style={[styles.versionRestore, { borderColor: T.border }]}
                      onPress={() => onRestore(v.id)}
                      disabled={restoring}
                    >
                      <ArrowCounterClockwise size={14} color={T.accent} weight="bold" />
                      <Text style={[styles.versionRestoreText, { color: T.accent }]}>
                        Restore
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, gap: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  previewCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewActions: { flexDirection: "row", gap: 12 },
  previewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  previewBtnText: { fontSize: 14, fontFamily: FONT.semibold },
  fileTitle: { fontSize: 20, fontFamily: FONT.bold, lineHeight: 28 },
  fileMeta: { fontSize: 13, fontFamily: FONT.regular, marginTop: 4 },
  uploaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  uploaderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  uploaderInitial: { fontSize: 14, fontFamily: FONT.semibold },
  uploaderName: { fontSize: 14, fontFamily: FONT.semibold },
  uploaderMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  descriptionCard: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  descriptionText: { fontSize: 14, fontFamily: FONT.regular, lineHeight: 20 },
  detailsCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  detailLabel: { fontSize: 13, fontFamily: FONT.regular },
  detailValue: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1, textAlign: "right" },
  metaSection: { gap: 10 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  tagsSection: { gap: 10 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tagText: { fontSize: 12, fontFamily: FONT.medium },
  tagAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  tagAddText: { fontSize: 12, fontFamily: FONT.medium },
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
    minHeight: 90,
    textAlignVertical: "top",
  },
  modalButtons: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  modalBtnText: { fontSize: 14, fontFamily: FONT.semibold },
  moveBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  versionsSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
  versionEmpty: { fontSize: 14, fontFamily: FONT.regular, padding: 24, textAlign: "center" },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  versionName: { fontSize: 14, fontFamily: FONT.semibold },
  versionMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  versionRestore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  versionRestoreText: { fontSize: 13, fontFamily: FONT.semibold },
});
