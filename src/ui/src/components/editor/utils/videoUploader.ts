import { filesApi } from '@/features/files/api/filesApi';
import { attachmentsApi } from '@/features/files/api/attachmentsApi';
import { buildMediaUrl } from '@/shared/utils/fileUrls';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

const attachmentsFolderCache = new Map<string, string>();

async function getAttachmentsFolderId(organizationId: string): Promise<string> {
    const cached = attachmentsFolderCache.get(organizationId);
    if (cached) {
        return cached;
    }

    const response = await attachmentsApi.getAttachmentsFolder({
        organizationId,
    });

    const folderId = response.folderId;
    attachmentsFolderCache.set(organizationId, folderId);
    return folderId;
}

export interface UploadVideoOptions {
    file: File;
    organizationId: string;
    /** Empty string defers attachment until the editor flushes content. */
    contentId: string;
    contentType: ContentType;
    onProgress?: (percent: number) => void;
    onFileUploaded?: (fileId: string) => void;
}

export async function uploadVideo(options: UploadVideoOptions): Promise<string> {
    const { file, organizationId, contentId, contentType, onProgress, onFileUploaded } = options;

    const folderId = await getAttachmentsFolderId(organizationId);
    onProgress?.(5);

    const initiateResponse = await filesApi.initiateUpload({
        organizationId,
        filename: file.name,
        mimeType: file.type || 'video/mp4',
        totalSize: BigInt(file.size),
        folderId,
    });

    const { uploadId, chunkSize, totalChunks } = initiateResponse;
    onProgress?.(10);

    const fileBuffer = await file.arrayBuffer();
    const progressPerChunk = 70 / totalChunks;

    for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        const start = (chunkNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkData = new Uint8Array(fileBuffer.slice(start, end));

        await filesApi.uploadChunk({
            uploadId,
            chunkNumber,
            data: chunkData,
            isLast: chunkNumber === totalChunks,
        });

        onProgress?.(10 + chunkNumber * progressPerChunk);
    }

    const completeResponse = await filesApi.completeUpload({
        uploadId,
    });

    const fileId = completeResponse.file?.id;
    if (!fileId) {
        throw new Error('Upload completed but no file ID returned');
    }
    onProgress?.(85);

    if (contentId) {
        await attachmentsApi.attachFile({
            organizationId,
            sourceFileId: fileId,
            contentType,
            contentId,
        });
    }
    onFileUploaded?.(fileId);
    onProgress?.(100);

    return buildMediaUrl(organizationId, fileId);
}

export function createVideoUploadHandler(
    contentType: ContentType,
    contentId: string,
    organizationId: string,
    onFileUploaded?: (fileId: string) => void,
): (file: File) => Promise<string> {
    return async (file: File): Promise<string> => {
        return uploadVideo({
            file,
            organizationId,
            contentId,
            contentType,
            onFileUploaded,
        });
    };
}
