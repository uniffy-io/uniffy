/**
 * Image Upload Utility for Editor
 *
 * Handles uploading images from the Crepe editor to the Attachments system.
 * Supports drag-drop, paste, and file picker uploads.
 * Works with any content type (notes, calendar events, tasks, etc.).
 */

import { filesApi } from '@/features/files/api/filesApi';
import { attachmentsApi } from '@/features/attachments';
import { buildFileUrl } from '@/shared/utils/fileUrls';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { VisibilityScope } from '@uniffy/proto/common/v1/common_pb';

// Cache for attachments folder ID per organization
const attachmentsFolderCache = new Map<string, string>();

/**
 * Get the user's attachments folder ID, with caching.
 */
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

export interface UploadImageOptions {
    /** The image file to upload */
    file: File;
    /** Organization ID for the upload */
    organizationId: string;
    /** Content ID to attach the image to (empty string = deferred attachment) */
    contentId: string;
    /** Content type for the attachment */
    contentType: ContentType;
    /** Optional progress callback (0-100) */
    onProgress?: (percent: number) => void;
    /** Called with the uploaded file ID (useful for deferred attachment when contentId is empty) */
    onFileUploaded?: (fileId: string) => void;
}

/**
 * Upload an image file and attach it to content.
 *
 * Flow:
 * 1. Get attachments folder ID (cached per org)
 * 2. Initiate upload via FilesService
 * 3. Upload file chunks
 * 4. Complete upload to get file ID
 * 5. Attach file to content via AttachmentsService
 * 6. Return permanent URL for the image
 *
 * @returns URL to the uploaded image: /api/files/{orgId}/{fileId}
 */
export async function uploadImage(options: UploadImageOptions): Promise<string> {
    const { file, organizationId, contentId, contentType, onProgress, onFileUploaded } = options;

    // 1. Get attachments folder ID
    const folderId = await getAttachmentsFolderId(organizationId);
    onProgress?.(5);

    // 2. Initiate upload
    const initiateResponse = await filesApi.initiateUpload({
        organizationId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        totalSize: BigInt(file.size),
        folderId,
        visibility: VisibilityScope.PRIVATE,
    });

    const { uploadId, chunkSize, totalChunks } = initiateResponse;
    onProgress?.(10);

    // 3. Upload chunks
    const fileBuffer = await file.arrayBuffer();
    const progressPerChunk = 70 / totalChunks; // 10-80% for chunk uploads

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

    // 4. Complete upload
    const completeResponse = await filesApi.completeUpload({
        uploadId,
    });

    const fileId = completeResponse.file?.id;
    if (!fileId) {
        throw new Error('Upload completed but no file ID returned');
    }
    onProgress?.(85);

    // 5. Attach file to content (skip when contentId is empty - deferred mode)
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

    // 6. Return permanent URL
    return buildFileUrl(organizationId, fileId);
}

/**
 * Create an image upload handler function for the Crepe editor.
 *
 * This factory function captures the contentId, contentType, and organizationId
 * so the returned handler can be passed directly to Crepe's ImageBlock config.
 *
 * @param contentType - The content type for the attachment
 * @param contentId - The content ID to attach uploaded images to
 * @param organizationId - The organization ID for the upload
 * @returns An async function that takes a File and returns a URL string
 */
export function createImageUploadHandler(
    contentType: ContentType,
    contentId: string,
    organizationId: string,
    onFileUploaded?: (fileId: string) => void,
): (file: File) => Promise<string> {
    return async (file: File): Promise<string> => {
        return uploadImage({
            file,
            organizationId,
            contentId,
            contentType,
            onFileUploaded,
        });
    };
}
