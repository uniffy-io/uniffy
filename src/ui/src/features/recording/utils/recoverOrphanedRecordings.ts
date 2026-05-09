/**
 * Recover orphaned screen recordings on app start.
 *
 * The streaming uploader mirrors every part to IndexedDB before sending
 * and removes it on ack. A tab crash mid-record leaves chunks behind in
 * IDB, indexed by the `MultipartUpload.id` they belong to. Server side,
 * the upload row stays `ACTIVE` for 24 h (then the reaper aborts it).
 *
 * On boot we:
 *   1. List upload ids whose chunks have been idle for > 60 s (the
 *      grace gives the live recording session in this tab a chance to
 *      ack its own chunks before we treat them as orphans).
 *   2. For each, ask the server `getUploadStatus`. If anything but
 *      `ACTIVE`, drop our local copy - the server already moved on.
 *   3. Otherwise upload any chunks the server doesn't have, then call
 *      `completeUpload`. The transcode / thumbnail pipelines run as
 *      normal because the server cannot tell the difference between a
 *      live finish and a recovered one.
 *   4. Surface a toast linking to the recovered file. On any failure,
 *      wipe local state and let the server-side reaper finish the
 *      cleanup - we never want recovery to loop forever.
 *
 * Idempotent across browser refreshes (each successful run clears its
 * state from IDB) and across tabs (a `recovery_lock:{uploadId}` BroadcastChannel
 * sentinel keeps two tabs from racing on the same upload).
 */

import { UploadStatus } from '@uniffy/proto/files/v1/files_pb';
import { filesApi } from '@/features/files/api/filesApi';
import {
    clearUpload,
    deleteChunk,
    listOrphanedUploads,
    loadPendingChunks,
} from '@/features/recording/utils/recordingChunkStore';

const ORPHAN_AGE_MS = 60_000;
const RECOVERY_CHANNEL = 'uniffy-recording-recovery';

interface RecoveryClaim {
    kind: 'claim';
    uploadId: string;
    tabId: string;
}

let recoveryRan = false;
const claimedByOtherTab = new Set<string>();
let recoveryChannel: BroadcastChannel | null = null;

function getRecoveryChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === 'undefined') return null;
    if (recoveryChannel) return recoveryChannel;
    try {
        recoveryChannel = new BroadcastChannel(RECOVERY_CHANNEL);
        recoveryChannel.addEventListener('message', (event: MessageEvent<RecoveryClaim>) => {
            if (event.data?.kind === 'claim') {
                claimedByOtherTab.add(event.data.uploadId);
            }
        });
        return recoveryChannel;
    } catch {
        return null;
    }
}

function tabId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `tab-${Math.random().toString(36).slice(2)}`;
}

export interface RecoveryResult {
    fileId: string;
    filename: string;
}

/**
 * Attempt to push every locally-buffered chunk for a single upload up
 * to the server, then call `completeUpload`.
 *
 * Used by:
 *   - the auto-recovery sweep on app boot (`recoverOrphanedRecordings`),
 *   - the manual "Retry" button on the inline trigger when state=error.
 *
 * Returns the recovered File metadata on success, `null` if the upload
 * is no longer active (server moved on; local state has been wiped).
 * Throws on transient failures so the caller can decide whether to
 * leave the IDB rows in place for a future attempt.
 */
export async function resumeUpload(uploadId: string): Promise<RecoveryResult | null> {
    const status = await filesApi.getUploadStatus({ uploadId });
    if (status.status !== UploadStatus.ACTIVE) {
        await clearUpload(uploadId);
        return null;
    }
    const completed = new Set<number>(
        status.completedChunks.map((n) => Number(n)),
    );
    const chunks = await loadPendingChunks(uploadId);
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
    await clearUpload(uploadId);
    if (!completion.file) return null;
    return {
        fileId: completion.file.id,
        filename: completion.file.filename,
    };
}

export async function recoverOrphanedRecordings(
    onRecovered: (info: RecoveryResult) => void,
): Promise<void> {
    if (recoveryRan) return;
    recoveryRan = true;

    let uploadIds: string[];
    try {
        uploadIds = await listOrphanedUploads(ORPHAN_AGE_MS);
    } catch {
        return;
    }
    if (uploadIds.length === 0) return;

    const channel = getRecoveryChannel();
    const myTab = tabId();

    for (const uploadId of uploadIds) {
        if (claimedByOtherTab.has(uploadId)) continue;
        channel?.postMessage({
            kind: 'claim',
            uploadId,
            tabId: myTab,
        } satisfies RecoveryClaim);

        try {
            const result = await resumeUpload(uploadId);
            if (result) {
                onRecovered(result);
            }
        } catch (err) {
            console.warn('[recording] recovery failed', uploadId, err);
            await clearUpload(uploadId);
        }
    }
}
