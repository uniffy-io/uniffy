import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@core/providers/AuthContext";
import { buildFileUrl, assetAuthHeaders } from "@features/files/fileUrls";
import { userFacingError } from "@shared/lib/userFacingError";

// Persisted Android SAF directory grant, so the second and later downloads skip
// the "pick a folder" prompt.
const SAF_DIR_KEY = "uniffy.files.downloadDir";

const NEEDS_BUILD_TITLE = "Update needed";
const NEEDS_BUILD_BODY =
  "Downloading and sharing files needs a fresh build of the app. Rebuild the dev client to enable it.";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
}

// expo-file-system + expo-sharing are native modules; a dev client built before
// they were added does not contain them. Requiring them lazily (rather than at
// module load) keeps the whole app from crashing at startup on such a binary -
// only the download action degrades until the client is rebuilt.
function nativeFileModules(): { FileSystem: any; Sharing: any } | null {
  try {
    return {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      FileSystem: require("expo-file-system/legacy"),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Sharing: require("expo-sharing"),
    };
  } catch {
    return null;
  }
}

// Android scoped storage: writing to a user-visible folder (Downloads, Documents)
// goes through the Storage Access Framework. The user picks a folder once; we
// remember the grant and copy bytes into a new file there.
async function grantedSafDir(SAF: any): Promise<string | null> {
  const saved = await AsyncStorage.getItem(SAF_DIR_KEY);
  if (saved) return saved;
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) return null;
  await AsyncStorage.setItem(SAF_DIR_KEY, perm.directoryUri);
  return perm.directoryUri;
}

async function writeToSaf(
  FileSystem: any,
  filename: string,
  mimeType: string | undefined,
  base64: string,
): Promise<string | null> {
  const SAF = FileSystem.StorageAccessFramework;
  const mt = mimeType || "application/octet-stream";
  // SAF derives the extension from the mime type, so pass the base name for a
  // known type (avoids "photo.png.png") but keep the full name when the type is
  // generic (SAF would otherwise drop the extension entirely).
  const dot = filename.lastIndexOf(".");
  const displayName =
    mt === "application/octet-stream" || dot <= 0 ? filename : filename.slice(0, dot);

  const attempt = async (dirUri: string) => {
    const destUri = await SAF.createFileAsync(dirUri, displayName, mt);
    await FileSystem.writeAsStringAsync(destUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return destUri;
  };

  const dir = await grantedSafDir(SAF);
  if (!dir) return null; // user dismissed the folder picker
  try {
    return await attempt(dir);
  } catch {
    // A persisted grant can go stale (folder deleted, permission revoked). Forget
    // it and ask once more before giving up.
    await AsyncStorage.removeItem(SAF_DIR_KEY);
    const fresh = await grantedSafDir(SAF);
    if (!fresh) return null;
    return await attempt(fresh);
  }
}

/**
 * Get files off the app two ways: `saveToDevice` writes into a user-visible
 * folder (Android SAF; the iOS share sheet, since iOS has no public Downloads),
 * and `saveOrShare` always opens the native share sheet.
 */
export function useFileDownload() {
  const { organizationId } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);

  const downloadToCache = useCallback(
    async (fileId: string, filename: string): Promise<string> => {
      const mods = nativeFileModules();
      if (!mods) throw new Error("Downloads need a fresh build of the app.");
      const target = `${mods.FileSystem.cacheDirectory}${sanitizeName(filename)}`;
      const result = await mods.FileSystem.downloadAsync(
        buildFileUrl(organizationId!, fileId),
        target,
        { headers: assetAuthHeaders() },
      );
      if (result.status !== 200) throw new Error(`Download failed (${result.status})`);
      return result.uri;
    },
    [organizationId],
  );

  const saveOrShare = useCallback(
    async (fileId: string, filename: string, mimeType?: string) => {
      if (!organizationId) return;
      const mods = nativeFileModules();
      if (!mods) {
        Alert.alert(NEEDS_BUILD_TITLE, NEEDS_BUILD_BODY);
        return;
      }
      setBusyId(fileId);
      try {
        const uri = await downloadToCache(fileId, filename);
        if (await mods.Sharing.isAvailableAsync()) {
          await mods.Sharing.shareAsync(uri, {
            mimeType: mimeType || undefined,
            dialogTitle: filename,
          });
        } else {
          Alert.alert("Downloaded", `Saved to ${uri}`);
        }
      } catch (err) {
        Alert.alert("Share failed", userFacingError(err, "The file was not shared."));
      } finally {
        setBusyId(null);
      }
    },
    [organizationId, downloadToCache],
  );

  const saveToDevice = useCallback(
    async (fileId: string, filename: string, mimeType?: string) => {
      if (!organizationId) return;
      const mods = nativeFileModules();
      if (!mods) {
        Alert.alert(NEEDS_BUILD_TITLE, NEEDS_BUILD_BODY);
        return;
      }
      // iOS apps have no user-facing Downloads folder; "Save to Files" in the
      // share sheet is the platform-idiomatic export.
      if (Platform.OS !== "android") {
        await saveOrShare(fileId, filename, mimeType);
        return;
      }
      setBusyId(fileId);
      try {
        const cacheUri = await downloadToCache(fileId, filename);
        const base64 = await mods.FileSystem.readAsStringAsync(cacheUri, {
          encoding: mods.FileSystem.EncodingType.Base64,
        });
        const dest = await writeToSaf(mods.FileSystem, filename, mimeType, base64);
        if (dest) Alert.alert("Saved", `"${filename}" was saved to your device.`);
      } catch (err) {
        Alert.alert("Download failed", userFacingError(err, "The file was not downloaded."));
      } finally {
        setBusyId(null);
      }
    },
    [organizationId, downloadToCache, saveOrShare],
  );

  return {
    saveToDevice,
    saveOrShare,
    downloadToCache,
    busyId,
    isBusy: (id: string) => busyId === id,
  };
}
