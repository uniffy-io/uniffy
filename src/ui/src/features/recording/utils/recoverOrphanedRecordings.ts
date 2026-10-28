/** Resumes scoped recording buffers after a tab closes before upload completes. */

import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import { filesApi } from "@/features/files/api/filesApi";
import type { UploadScope } from "@/features/files/upload/uploadTypes";
import { getUploadScope } from "@/features/files/upload/uploadScope";
import { isStorageEncryptionReady } from "@/shared/crypto/storageEncryption";
import {
  clearUploadChunks,
  deleteChunk,
  listOrphanedChunkUploads,
  loadPendingChunks,
} from "@/features/files/upload/uploadStore";

const ORPHAN_AGE_MS = 60_000;
const RECOVERY_CHANNEL = "uniffy-recording-recovery";

interface RecoveryClaim {
  kind: "claim";
  uploadId: string;
  tabId: string;
}

const recoveredScopes = new Set<string>();
const claimedByOtherTab = new Set<string>();
let recoveryChannel: BroadcastChannel | null = null;

function getRecoveryChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (recoveryChannel) return recoveryChannel;
  try {
    recoveryChannel = new BroadcastChannel(RECOVERY_CHANNEL);
    recoveryChannel.addEventListener("message", (event: MessageEvent<RecoveryClaim>) => {
      if (event.data?.kind === "claim") {
        claimedByOtherTab.add(event.data.uploadId);
      }
    });
    return recoveryChannel;
  } catch {
    return null;
  }
}

function tabId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tab-${Math.random().toString(36).slice(2)}`;
}

export interface RecoveryResult {
  fileId: string;
  filename: string;
}

/** Pushes IDB-buffered chunks then completes; returns null if the server-side upload is no longer ACTIVE. */
export async function resumeUpload(
  uploadId: string,
  scope: UploadScope | null = getUploadScope(),
): Promise<RecoveryResult | null> {
  // Read every part before completing anything; unavailable keys must never look like an empty buffer.
  const chunks = await loadPendingChunks(uploadId, scope);
  const status = await filesApi.getUploadStatus({ uploadId });
  if (status.status !== UploadStatus.ACTIVE) {
    await clearUploadChunks(uploadId);
    return null;
  }
  const completed = new Set<number>(status.completedChunks.map((n) => Number(n)));
  for (const chunk of chunks) {
    if (completed.has(chunk.partNumber)) {
      await deleteChunk(uploadId, chunk.partNumber);
      continue;
    }
    const buffer = new Uint8Array(await chunk.blob.arrayBuffer());
    await filesApi.uploadChunk({
      uploadId,
      chunkNumber: chunk.partNumber,
      data: buffer,
      isLast: false,
    });
    await deleteChunk(uploadId, chunk.partNumber);
  }
  const completion = await filesApi.completeUpload({ uploadId });
  await clearUploadChunks(uploadId);
  if (!completion.file) return null;
  return {
    fileId: completion.file.id,
    filename: completion.file.filename,
  };
}

/** Runs once per account and organization; without a tab scope nothing is matched and a later call retries. */
export async function recoverOrphanedRecordings(
  onRecovered: (info: RecoveryResult) => void,
  scope: UploadScope | null = getUploadScope(),
): Promise<void> {
  if (!scope || !isStorageEncryptionReady()) return;
  const scopeKey = `${scope.userId}|${scope.organizationId}`;
  if (recoveredScopes.has(scopeKey)) return;
  recoveredScopes.add(scopeKey);

  let uploadIds: string[];
  try {
    uploadIds = await listOrphanedChunkUploads(ORPHAN_AGE_MS, scope);
  } catch {
    recoveredScopes.delete(scopeKey);
    return;
  }
  if (uploadIds.length === 0) return;

  const channel = getRecoveryChannel();
  const myTab = tabId();

  for (const uploadId of uploadIds) {
    if (claimedByOtherTab.has(uploadId)) continue;
    channel?.postMessage({
      kind: "claim",
      uploadId,
      tabId: myTab,
    } satisfies RecoveryClaim);

    try {
      const result = await resumeUpload(uploadId, scope);
      if (result) {
        onRecovered(result);
      }
    } catch (err) {
      console.warn("[recording] recovery failed", uploadId, err);
      recoveredScopes.delete(scopeKey);
    }
  }
}
