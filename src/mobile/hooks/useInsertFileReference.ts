import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "@/context/auth-context";
import { useUniffy } from "@/context/uniffy-context";
import { uploadAsset } from "@/hooks/useFileMutations";
import { filesApi } from "@/api/filesApi";

type PickedAsset = { uri: string; name: string; mimeType: string };

// Picks a photo/document, uploads it into the org attachments folder, and drops
// a reference chip into the focused editor through the shared mention pipeline
// (insertReference -> pendingReference -> useMentionInput), so the file rides
// the note body as a real [[[label|urn]]] mention.
export function useInsertFileReference() {
  const { organizationId } = useAuth();
  const { insertReference } = useUniffy();
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (asset: PickedAsset) => {
      if (!organizationId) return;
      setUploading(true);
      try {
        const folder = await filesApi.getAttachmentsFolder({ organizationId });
        const res = await uploadAsset(organizationId, {
          uri: asset.uri,
          filename: asset.name,
          mimeType: asset.mimeType,
          size: 0,
          folderId: folder.folderId,
        });
        const fileId = res.file?.id;
        if (fileId) {
          insertReference({ id: fileId, label: asset.name, domain: "files" });
        } else {
          Alert.alert("Upload failed", "The file could not be attached.");
        }
      } catch {
        Alert.alert("Upload failed", "The file could not be attached.");
      } finally {
        setUploading(false);
      }
    },
    [organizationId, insertReference],
  );

  const pickPhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.9,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    const mimeType = a.mimeType ?? "image/jpeg";
    await upload({
      uri: a.uri,
      name: a.fileName || `media-${Date.now()}.${mimeType.split("/")[1] ?? "jpg"}`,
      mimeType,
    });
  }, [upload]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const a = result.assets[0];
    await upload({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/octet-stream" });
  }, [upload]);

  const attach = useCallback(() => {
    Alert.alert("Add attachment", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Photo or video", onPress: () => void pickPhoto() },
      { text: "Document", onPress: () => void pickDocument() },
    ]);
  }, [pickPhoto, pickDocument]);

  return { attach, uploading };
}
