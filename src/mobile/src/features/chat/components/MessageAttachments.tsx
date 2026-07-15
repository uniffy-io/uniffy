import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { FileText, FileAudio, FileVideo, FileZip, File as FileIcon } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { assetAuthHeaders, buildFileUrl } from "@features/files/fileUrls";
import { formatSize } from "@features/files/fileSerializer";
import type { SerializedAttachment } from "@features/chat/chatSerializer";

const MAX_GRID_IMAGES = 4;

function fileIconFor(mimeType: string) {
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return FileZip;
  if (mimeType.startsWith("text/") || mimeType.includes("pdf") || mimeType.includes("document")) {
    return FileText;
  }
  return FileIcon;
}

function openFile(fileId: string) {
  router.push(`/files/${fileId}` as never);
}

export function MessageAttachments({
  attachments,
  organizationId,
  T,
}: {
  attachments: SerializedAttachment[];
  organizationId: string;
  T: ThemeColors;
}) {
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const others = attachments.filter((a) => !a.mimeType.startsWith("image/"));
  const authHeaders = assetAuthHeaders();

  const visibleImages = images.slice(0, MAX_GRID_IMAGES);
  const overflow = images.length - visibleImages.length;

  return (
    <View style={styles.wrap}>
      {visibleImages.length === 1 ? (
        <TouchableOpacity activeOpacity={0.85} onPress={() => openFile(visibleImages[0].fileId)}>
          <Image
            source={{
              uri: buildFileUrl(organizationId, visibleImages[0].fileId),
              headers: authHeaders,
            }}
            style={[styles.singleImage, { backgroundColor: T.surface }]}
            contentFit="cover"
            transition={120}
          />
        </TouchableOpacity>
      ) : visibleImages.length > 1 ? (
        <View style={styles.grid}>
          {visibleImages.map((img, i) => (
            <TouchableOpacity
              key={img.id}
              activeOpacity={0.85}
              style={styles.gridCell}
              onPress={() => openFile(img.fileId)}
            >
              <Image
                source={{
                  uri: buildFileUrl(organizationId, img.fileId),
                  headers: authHeaders,
                }}
                style={[styles.gridImage, { backgroundColor: T.surface }]}
                contentFit="cover"
                transition={120}
              />
              {overflow > 0 && i === visibleImages.length - 1 ? (
                <View style={styles.overflowScrim}>
                  <Text style={styles.overflowText}>+{overflow}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {others.map((att) => {
        const Icon = fileIconFor(att.mimeType);
        return (
          <TouchableOpacity
            key={att.id}
            style={[styles.fileCard, { backgroundColor: T.surface, borderColor: T.border }]}
            onPress={() => openFile(att.fileId)}
            activeOpacity={0.7}
          >
            <View style={[styles.fileIconWrap, { backgroundColor: T.accentSoft }]}>
              <Icon size={18} color={T.accent} weight="duotone" />
            </View>
            <View style={styles.fileMeta}>
              <Text style={[styles.fileName, { color: T.textBright }]} numberOfLines={1}>
                {att.filename}
              </Text>
              <Text style={[styles.fileSize, { color: T.textDim }]}>
                {formatSize(att.sizeBytes)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 4 },
  singleImage: { width: 240, height: 180, borderRadius: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, maxWidth: 300 },
  gridCell: { width: 145, height: 110 },
  gridImage: { width: "100%", height: "100%", borderRadius: 10 },
  overflowScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowText: { color: "#fff", fontSize: 20, fontFamily: FONT.bold },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 300,
  },
  fileIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  fileMeta: { flex: 1 },
  fileName: { fontSize: 13, fontFamily: FONT.medium },
  fileSize: { fontSize: 11, fontFamily: FONT.regular, marginTop: 1 },
});
