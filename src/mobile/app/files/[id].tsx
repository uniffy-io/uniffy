import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { DotsThree, LinkSimple } from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { CommentButton } from "@/components/CommentsSheet";
import { ShareButton } from "@/components/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useTheme } from "@/hooks/useTheme";
import { FILE_COLORS } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import { ENV } from "@/constants/env";
import { getAccessToken } from "@/lib/auth";
import { useFile } from "@/hooks/useFiles";
import { useDeleteFile } from "@/hooks/useFileMutations";
import { useAuth } from "@/context/auth-context";

function getFileColor(ext: string) {
  return FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
}

export default function FileDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const auth = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const fileQuery = useFile(id);
  const deleteFile = useDeleteFile();

  if (fileQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Files" color={T.domains.files} icon="files" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.domains.files} />
        </View>
      </View>
    );
  }

  const file = fileQuery.data;
  if (!file) return null;

  const fileColor = getFileColor(file.ext);
  const uploaderName = file.ownerInfo?.name || auth.user?.fullName || "Unknown";

  const isImage = file.mimeType.startsWith("image/");
  // Asset routes accept a Bearer token (cookie or Bearer), so expo-image can
  // load authenticated bytes directly with an Authorization header.
  const assetUri = `${ENV.apiUrl}/files/${auth.organizationId ?? ""}/${file.id}`;
  const authHeaders = { Authorization: `Bearer ${getAccessToken() ?? ""}` };

  const copyReferenceLink = async () => {
    await Clipboard.setStringAsync(`urn:uniffy:content:FILE:${file.id}`);
    Alert.alert("Copied", "Reference link copied to clipboard.");
  };

  const DETAILS = [
    { label: "Type", value: file.ext.toUpperCase() + " Document" },
    { label: "Size", value: file.size },
    { label: "MIME Type", value: file.mimeType },
    { label: "Modified", value: file.editedAt },
    { label: "Version", value: `v${file.version}` },
  ];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Files"
        color={T.domains.files}
        icon="files"
        rightActions={
          <>
            <CommentButton
              contentType={ContentType.FILE}
              contentId={file.id}
              color={T.domains.files}
            />
            <ShareButton
              contentType={ContentType.FILE}
              contentId={file.id}
              color={T.domains.files}
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

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.previewCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          {isImage ? (
            <Image
              source={{ uri: assetUri, headers: authHeaders }}
              style={styles.previewImage}
              contentFit="contain"
              transition={150}
            />
          ) : (
            <View style={[styles.previewIcon, { backgroundColor: fileColor + "18" }]}>
              <Text style={[styles.previewExt, { color: fileColor }]}>
                {file.ext.toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={[
                styles.previewBtn,
                { backgroundColor: T.surfaceHover, borderColor: T.border, borderWidth: 1 },
              ]}
              onPress={copyReferenceLink}
            >
              <LinkSimple size={14} color={T.text} weight="duotone" />
              <Text style={[styles.previewBtnText, { color: T.text }]}>Copy link</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View>
          <Text style={[styles.fileTitle, { color: T.textBright }]}>{file.filename}</Text>
          <Text style={[styles.fileMeta, { color: T.textDim }]}>
            {file.size} · Uploaded {file.editedAt}
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

        {file.description ? (
          <View
            style={[styles.descriptionCard, { backgroundColor: T.surface, borderColor: T.border }]}
          >
            <Text style={[styles.descriptionText, { color: T.text }]}>{file.description}</Text>
          </View>
        ) : null}

        <View style={[styles.detailsCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          {DETAILS.map((d, i) => (
            <View
              key={d.label}
              style={[
                styles.detailRow,
                {
                  borderBottomColor: T.border,
                  borderBottomWidth: i < DETAILS.length - 1 ? StyleSheet.hairlineWidth : 0,
                },
              ]}
            >
              <Text style={[styles.detailLabel, { color: T.textDim }]}>{d.label}</Text>
              <Text style={[styles.detailValue, { color: T.textBright }]}>{d.value}</Text>
            </View>
          ))}
        </View>

        {file.tags.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>TAGS</Text>
            <View style={styles.tagsRow}>
              {file.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: T.accentSoft }]}>
                  <Text style={[styles.tagText, { color: T.accent }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={file.filename}
        subtitle={`${file.size} · v${file.version}`}
        icon="files"
        iconColor={fileColor}
        actions={[
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, gap: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  previewCard: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  previewExt: { fontSize: 18, fontFamily: FONT.bold, letterSpacing: 1 },
  previewImage: { width: "100%", height: 260, borderRadius: 12 },
  previewActions: { flexDirection: "row", gap: 12 },
  previewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  previewBtnText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
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
  descriptionCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  descriptionText: { fontSize: 14, fontFamily: FONT.regular, lineHeight: 20 },
  detailsCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  detailLabel: { fontSize: 13, fontFamily: FONT.regular },
  detailValue: { fontSize: 13, fontFamily: FONT.medium },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  tagsSection: { gap: 10 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tagText: { fontSize: 12, fontFamily: FONT.medium },
});
