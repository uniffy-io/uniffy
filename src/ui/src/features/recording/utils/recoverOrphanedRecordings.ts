/**
 * Recovers orphaned screen recordings on boot: IDB-buffered chunks whose `MultipartUpload` is still
 * ACTIVE server-side (24h TTL) get re-uploaded and completed. 60s idle grace skips the live session's
 * own chunks. Cross-tab races guarded by a BroadcastChannel claim.
 */

import { UploadStatus } from '@uniffy/proto/files/v1/files_pb';
import { filesApi } from '@/features/files/api/filesApi';
import {
    clearUploadChunks,
    deleteChunk,
    listOrphanedChunkUploads,
    loadPendingChunks,
} from '@/features/files/upload/uploadStore';

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

/** Pushes IDB-buffered chunks then completes; returns null if the server-side upload is no longer ACTIVE. */
export async function resumeUpload(uploadId: string): Promise<RecoveryResult | null> {
    const status = await filesApi.getUploadStatus({ uploadId });
    if (status.status !== UploadStatus.ACTIVE) {
        await clearUploadChunks(uploadId);
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
    await clearUploadChunks(uploadId);
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
        uploadIds = await listOrphanedChunkUploads(ORPHAN_AGE_MS);
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
            await clearUploadChunks(uploadId);
        }
    }
}
