/**
 * Upload Processor Hook
 *
 * Processes the upload queue, streaming file chunks to the backend.
 * Uses Web Workers for CPU-intensive chunking and uploading operations.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { filesApi } from '@/features/files/api/filesApi';
import { bulkUpsertTags, tagToPlain } from '@/features/tags';
import { getFile, removeFile as removeStoredFile } from '@/features/files/utils/fileStore';
import { fileWorkerManager } from '@/features/files/workers';
import { getAccessToken, refreshAccessToken } from '@/config/api';
import { env } from '@/config/env';
import {
    startUpload,
    updateProgress,
    setCompleting,
    completeUpload,
    failUpload,
    selectAbortedUploads,
} from '@/features/files/store/uploadSlice';
import { setFile } from '@/features/files/store/filesSlice';
import type { UploadItem } from '@/features/files/store/uploadSlice';

/**
 * Process a single file upload using Web Worker for chunking.
 * The worker handles file slicing and chunk uploads off the main thread.
 */
async function processUpload(
    item: UploadItem,
    file: File,
    organizationId: string,
    dispatch: ReturnType<typeof useAppDispatch>
    // TODO: Integrate abort signal with worker operations
): Promise<void> {
    console.log('[Upload] Starting upload for:', item.filename, 'org:', organizationId);

    // 1. Initiate upload to get upload_id and chunk parameters (main thread - uses auth interceptor)
    let initResponse;
    try {
        initResponse = await filesApi.initiateUpload({
            organizationId,
            filename: item.filename,
            mimeType: item.mimeType,
            totalSize: BigInt(item.totalSize),
            folderId: item.folderId,
            accessMode: item.accessMode,
        });
        console.log('[Upload] Initiated:', initResponse);
    } catch (error) {
        console.error('[Upload] Failed to initiate upload:', error);
        throw error;
    }

    const { uploadId, chunkSize, totalChunks } = initResponse;

    // Update state with upload session info
    dispatch(startUpload({
        itemId: item.id,
        uploadId,
        chunkSize,
        totalChunks,
    }));

    // 2. Upload file chunks in worker (off main thread)
    console.log('[Upload] Starting worker upload, total chunks:', totalChunks);

    try {
        await fileWorkerManager.uploadChunks({
            file,
            uploadId,
            chunkSize,
            totalChunks,
            apiUrl: env.apiBaseUrl,
            onProgress: (uploadedChunks, uploadedBytes) => {
                dispatch(updateProgress({
                    itemId: item.id,
                    uploadedChunks,
                    uploadedBytes,
                }));
            },
        });
    } catch (error) {
        console.error('[Upload] Worker chunk upload failed:', error);
        throw error;
    }

    console.log('[Upload] All chunks uploaded, completing...');
    dispatch(setCompleting(item.id));

    // 3. Complete the upload (main thread - uses auth interceptor)
    let response;
    try {
        response = await filesApi.completeUpload({ uploadId });
        console.log('[Upload] completeUpload response:', response);
    } catch (error) {
        console.error('[Upload] completeUpload failed:', error);
        throw error;
    }

    // 4. Handle completion - add file to state
    if (response.file) {
        // Convert proto File to serialized format and add to files state
        const protoFile = response.file;

        if (protoFile.tags.length > 0) {
            dispatch(bulkUpsertTags(protoFile.tags.map(tagToPlain)));
        }
        console.log('[Upload] Completed file:', {
            id: protoFile.id,
            filename: protoFile.filename,
            folderId: protoFile.folderId,
            originalFolderId: item.folderId,
        });

        // Helper to convert bigint to number
        const toNumber = (val: bigint | number | undefined): number =>
            typeof val === 'bigint' ? Number(val) : (val ?? 0);

        // Helper to convert proto timestamp to serialized format
        const serializeTimestamp = (ts: { seconds?: bigint | number; nanos?: number } | undefined) =>
            ts ? { seconds: toNumber(ts.seconds), nanos: ts.nanos ?? 0 } : undefined;

        dispatch(setFile({
            id: protoFile.id,
            urn: protoFile.urn,
            organizationId: protoFile.organizationId,
            ownerId: protoFile.ownerId,
            accessMode: protoFile.accessMode,
            baselineRole: protoFile.baselineRole ?? null,
            userRole: protoFile.userRole,
            filename: protoFile.filename,
            originalFilename: protoFile.originalFilename,
            mimeType: protoFile.mimeType,
            sizeBytes: toNumber(protoFile.sizeBytes),
            folderId: protoFile.folderId,
            tagIds: protoFile.tags.map((tag) => tag.id),
            description: protoFile.description,
            version: protoFile.version,
            extractionStatus: protoFile.extractionStatus,
            transcodeStatus: protoFile.transcodeStatus,
            isDeleted: protoFile.isDeleted,
            createdAt: serializeTimestamp(protoFile.createdAt),
            updatedAt: serializeTimestamp(protoFile.updatedAt),
            deletedAt: serializeTimestamp(protoFile.deletedAt),
            groupIds: [...protoFile.groupIds],
            ownerInfo: protoFile.ownerInfo ? {
                id: protoFile.ownerInfo.id,
                name: protoFile.ownerInfo.name,
                email: protoFile.ownerInfo.email,
            } : undefined,
            metadata: protoFile.metadata ? {
                hasThumbnail: protoFile.metadata.hasThumbnail,
                width: protoFile.metadata.width,
                height: protoFile.metadata.height,
                format: protoFile.metadata.format,
                colorMode: protoFile.metadata.colorMode,
                durationSeconds: protoFile.metadata.durationSeconds,
                pageCount: protoFile.metadata.pageCount,
                bitrate: protoFile.metadata.bitrate,
                sampleRate: protoFile.metadata.sampleRate,
                channels: protoFile.metadata.channels,
                exif: { ...protoFile.metadata.exif },
                error: protoFile.metadata.error,
            } : undefined,
        }));

        dispatch(completeUpload({
            itemId: item.id,
            fileId: protoFile.id,
        }));
    } else {
        throw new Error('Upload completed but no file returned');
    }

    // Clean up stored File object
    removeStoredFile(item.id);
}

/**
 * Hook that processes the upload queue.
 * Should be called once at the page level.
 */
export function useUploadProcessor() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const queue = useAppSelector((state) => state.upload.queue);
    const activeUploads = useAppSelector((state) => state.upload.activeUploads);
    const maxConcurrentUploads = useAppSelector((state) => state.upload.maxConcurrentUploads);

    // Track active upload abort controllers
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
    const processingRef = useRef<Set<string>>(new Set());

    // Initialize file worker manager with token functions
    useEffect(() => {
        if (!fileWorkerManager.isInitialized()) {
            fileWorkerManager.init(getAccessToken, refreshAccessToken);
        }
    }, []);

    // Process next items in queue
    const processQueue = useCallback(async () => {
        console.log('[Upload] processQueue called', { organizationId, queueLength: queue.length, activeCount: Object.keys(activeUploads).length });

        if (!organizationId) {
            console.log('[Upload] No organizationId, skipping');
            return;
        }

        const activeCount = Object.keys(activeUploads).length;
        const availableSlots = maxConcurrentUploads - activeCount;

        if (availableSlots <= 0 || queue.length === 0) {
            console.log('[Upload] No slots available or queue empty', { availableSlots, queueLength: queue.length });
            return;
        }

        // Get items to process (not already being processed)
        const itemsToProcess = queue
            .filter((item) => !processingRef.current.has(item.id))
            .slice(0, availableSlots);

        for (const item of itemsToProcess) {
            // Mark as processing to prevent duplicate processing
            processingRef.current.add(item.id);

            // Get the stored File object
            const file = getFile(item.id);
            if (!file) {
                dispatch(failUpload({
                    itemId: item.id,
                    error: 'File data not found',
                }));
                processingRef.current.delete(item.id);
                continue;
            }

            // Create abort controller for this upload
            const abortController = new AbortController();
            abortControllersRef.current.set(item.id, abortController);

            // Process upload (don't await - let it run concurrently)
            processUpload(item, file, organizationId, dispatch)
                .then(() => {
                    console.log('[Upload] processUpload completed successfully for:', item.filename);
                })
                .catch((error) => {
                    console.error('[Upload] processUpload failed for:', item.filename, error);
                    if (error.message !== 'Upload aborted') {
                        dispatch(failUpload({
                            itemId: item.id,
                            error: error.message || 'Upload failed',
                        }));
                    }
                })
                .finally(() => {
                    processingRef.current.delete(item.id);
                    abortControllersRef.current.delete(item.id);
                });
        }
    }, [organizationId, queue, activeUploads, maxConcurrentUploads, dispatch]);

    // Process queue when it changes
    useEffect(() => {
        processQueue();
    }, [processQueue]);

    // Handle abort requests from uploadSlice
    const abortedItems = useAppSelector(selectAbortedUploads);

    useEffect(() => {
        // Abort any uploads that were marked as aborted
        for (const item of abortedItems) {
            const controller = abortControllersRef.current.get(item.id);
            if (controller) {
                controller.abort();
            }
        }
    }, [abortedItems]);

    // Cleanup on unmount
    useEffect(() => {
        // Capture ref value inside effect to avoid stale reference in cleanup
        const controllers = abortControllersRef.current;
        return () => {
            // Abort all active uploads
            for (const controller of controllers.values()) {
                controller.abort();
            }
        };
    }, []);
}
