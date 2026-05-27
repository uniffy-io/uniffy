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

async function processUpload(
    item: UploadItem,
    file: File,
    organizationId: string,
    dispatch: ReturnType<typeof useAppDispatch>
): Promise<void> {
    const initResponse = await filesApi.initiateUpload({
        organizationId,
        filename: item.filename,
        mimeType: item.mimeType,
        totalSize: BigInt(item.totalSize),
        folderId: item.folderId,
        accessMode: item.accessMode,
    });

    const { uploadId, chunkSize, totalChunks } = initResponse;

    dispatch(startUpload({
        itemId: item.id,
        uploadId,
        chunkSize,
        totalChunks,
    }));

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

    dispatch(setCompleting(item.id));

    const response = await filesApi.completeUpload({ uploadId });

    if (response.file) {
        const protoFile = response.file;

        if (protoFile.tags.length > 0) {
            dispatch(bulkUpsertTags(protoFile.tags.map(tagToPlain)));
        }

        const toNumber = (val: bigint | number | undefined): number =>
            typeof val === 'bigint' ? Number(val) : (val ?? 0);

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

    removeStoredFile(item.id);
}

/** Mount once at the page level; drains the upload queue. */
export function useUploadProcessor() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const queue = useAppSelector((state) => state.upload.queue);
    const activeUploads = useAppSelector((state) => state.upload.activeUploads);
    const maxConcurrentUploads = useAppSelector((state) => state.upload.maxConcurrentUploads);

    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
    const processingRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!fileWorkerManager.isInitialized()) {
            fileWorkerManager.init(getAccessToken, refreshAccessToken);
        }
    }, []);

    const processQueue = useCallback(async () => {
        if (!organizationId) {
            return;
        }

        const activeCount = Object.keys(activeUploads).length;
        const availableSlots = maxConcurrentUploads - activeCount;

        if (availableSlots <= 0 || queue.length === 0) {
            return;
        }

        const itemsToProcess = queue
            .filter((item) => !processingRef.current.has(item.id))
            .slice(0, availableSlots);

        for (const item of itemsToProcess) {
            processingRef.current.add(item.id);

            const file = getFile(item.id);
            if (!file) {
                dispatch(failUpload({
                    itemId: item.id,
                    error: 'File data not found',
                }));
                processingRef.current.delete(item.id);
                continue;
            }

            const abortController = new AbortController();
            abortControllersRef.current.set(item.id, abortController);

            processUpload(item, file, organizationId, dispatch)
                .catch((error) => {
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

    useEffect(() => {
        processQueue();
    }, [processQueue]);

    const abortedItems = useAppSelector(selectAbortedUploads);

    useEffect(() => {
        for (const item of abortedItems) {
            const controller = abortControllersRef.current.get(item.id);
            if (controller) {
                controller.abort();
            }
        }
    }, [abortedItems]);

    useEffect(() => {
        // Capture inside the effect so cleanup sees the same map even after unmount.
        const controllers = abortControllersRef.current;
        return () => {
            for (const controller of controllers.values()) {
                controller.abort();
            }
        };
    }, []);
}
