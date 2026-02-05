/**
 * Image Upload Utility for Notes Editor
 *
 * Handles uploading images from the Crepe editor to the Attachments system.
 * Supports drag-drop, paste, and file picker uploads.
 */

import { filesApi } from '@/features/files/api/filesApi';
import { attachmentsApi } from '@/features/attachments';
import { ContentType } from '@/gen/common/v1/common_pb';
import { VisibilityScope } from '@/gen/common/v1/common_pb';

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

export interface UploadNoteImageOptions {
    /** The image file to upload */
    file: File;
    /** Organization ID for the upload */
    organizationId: string;
    /** Note ID to attach the image to */
    noteId: string;
    /** Optional progress callback (0-100) */
    onProgress?: (percent: number) => void;
}

/**
 * Upload an image file and attach it to a note.
 *
 * Flow:
 * 1. Get attachments folder ID (cached per org)
 * 2. Initiate upload via FilesService
 * 3. Upload file chunks
 * 4. Complete upload to get file ID
 * 5. Attach file to note via AttachmentsService
 * 6. Return permanent URL for the image
 *
 * @returns URL to the uploaded image: /api/files/{orgId}/{fileId}
 */
export async function uploadNoteImage(options: UploadNoteImageOptions): Promise<string> {
    const { file, organizationId, noteId, onProgress } = options;

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

    // 5. Attach file to note
    await attachmentsApi.attachFile({
        organizationId,
        sourceFileId: fileId,
        contentType: ContentType.NOTE,
        contentId: noteId,
    });
    onProgress?.(100);

    // 6. Return permanent URL
    return `/api/files/${organizationId}/${fileId}`;
}

/**
 * Create an image upload handler function for the Crepe editor.
 *
 * This factory function captures the noteId and organizationId so the
 * returned handler can be passed directly to Crepe's ImageBlock config.
 *
 * @param noteId - The note ID to attach uploaded images to
 * @param organizationId - The organization ID for the upload
 * @returns An async function that takes a File and returns a URL string
 */
export function createImageUploadHandler(
    noteId: string,
    organizationId: string
): (file: File) => Promise<string> {
    return async (file: File): Promise<string> => {
        return uploadNoteImage({
            file,
            organizationId,
            noteId,
        });
    };
}
