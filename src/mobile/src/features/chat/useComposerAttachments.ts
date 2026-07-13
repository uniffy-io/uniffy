import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "@core/providers/auth-context";
import { uploadAsset } from "@features/files/useFileMutations";
import { filesApi } from "@features/files/filesApi";

export type PendingAttachment = {
  localId: string;
  filename: string;
  mimeType: string;
  uri: string;
  fileId: string | null;
  progress: number;
  error: boolean;
};

type PickedAsset = { uri: string; name: string; mimeType: string };

// Composer attachment pipeline: pick, upload into the shared attachments
// folder, track per-item progress. The ready file ids ride on SendMessage.
export function useComposerAttachments() {
  const { organizationId } = useAuth();
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  const uploadPicked = useCallback(
    (assets: PickedAsset[]) => {
      if (!organizationId) return;
      for (const asset of assets) {
        const localId = `att-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        setPending((prev) => [
          ...prev,
          {
            localId,
            filename: asset.name,
            mimeType: asset.mimeType,
            uri: asset.uri,
            fileId: null,
            progress: 0,
            error: false,
          },
        ]);
        void (async () => {
          try {
            const folderRes = await filesApi.getAttachmentsFolder({ organizationId });
            const res = await uploadAsset(
              organizationId,
              {
                uri: asset.uri,
                filename: asset.name,
                mimeType: asset.mimeType,
                size: 0,
                folderId: folderRes.folderId,
              },
              (pct) =>
                setPending((prev) =>
                  prev.map((p) => (p.localId === localId ? { ...p, progress: pct } : p)),
                ),
            );
            const fileId = res.file?.id ?? null;
            setPending((prev) =>
              prev.map((p) =>
                p.localId === localId ? { ...p, fileId, progress: 100, error: !fileId } : p,
              ),
            );
          } catch {
            setPending((prev) =>
              prev.map((p) => (p.localId === localId ? { ...p, error: true } : p)),
            );
          }
        })();
      }
    },
    [organizationId],
  );

  const pickPhotos = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (result.canceled) return;
    uploadPicked(
      result.assets.map((a) => {
        const mimeType = a.mimeType ?? "image/jpeg";
        return {
          uri: a.uri,
          name: a.fileName || `media-${Date.now()}.${mimeType.split("/")[1] ?? "jpg"}`,
          mimeType,
        };
      }),
    );
  }, [uploadPicked]);

  const pickDocuments = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    uploadPicked(
      result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType ?? "application/octet-stream",
      })),
    );
  }, [uploadPicked]);

  const handleAttach = useCallback(() => {
    Alert.alert("Add attachment", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Photo or video", onPress: () => void pickPhotos() },
      { text: "Document", onPress: () => void pickDocuments() },
    ]);
  }, [pickPhotos, pickDocuments]);

  const remove = useCallback((localId: string) => {
    setPending((prev) => prev.filter((p) => p.localId !== localId));
  }, []);

  const clear = useCallback(() => setPending([]), []);

  const uploading = pending.some((p) => !p.fileId && !p.error);
  const readyFileIds = pending.filter((p) => p.fileId).map((p) => p.fileId as string);

  return { pending, handleAttach, remove, clear, uploading, readyFileIds };
}
