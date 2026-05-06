/**
 * Attachments API Service
 *
 * Centralized ConnectRPC client for attachment operations.
 * Handles linking files to content (notes, chat messages, etc.).
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { AttachmentsService } from '@uniffy/proto/attachments/v1/attachments_connect';
import type {
    AttachFileRequest,
    BatchListAttachmentsRequest,
    DetachFileRequest,
    ListAttachmentsRequest,
    ListSharedAttachmentsRequest,
    GetAttachmentsFolderRequest,
} from '@uniffy/proto/attachments/v1/attachments_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create an attachments service client with the shared transport.
 */
const attachmentsClient = createClient(AttachmentsService, transport);

/**
 * Attachments API service with typed methods.
 */
export const attachmentsApi = {
    /**
     * Attach a file to content.
     * The file will be copied to the user's Attachments folder if not already there.
     */
    attachFile: async (request: PartialMessage<AttachFileRequest>) => {
        return attachmentsClient.attachFile(request);
    },

    /**
     * Detach a file from content (deletes the attachment and the file).
     */
    detachFile: async (request: PartialMessage<DetachFileRequest>) => {
        return attachmentsClient.detachFile(request);
    },

    /**
     * List all attachments for a piece of content.
     */
    listAttachments: async (request: PartialMessage<ListAttachmentsRequest>) => {
        return attachmentsClient.listAttachments(request);
    },

    /**
     * Batch-list attachments for many content rows of the same type.
     * Use this for hot paths (chat channel open) instead of N parallel
     * `listAttachments` calls.
     */
    batchListAttachments: async (request: PartialMessage<BatchListAttachmentsRequest>) => {
        return attachmentsClient.batchListAttachments(request);
    },

    /**
     * List attachments from content shared with the user.
     */
    listSharedAttachments: async (request: PartialMessage<ListSharedAttachmentsRequest>) => {
        return attachmentsClient.listSharedAttachments(request);
    },

    /**
     * Get the user's Attachments folder ID.
     * Use this folder_id with FilesService.InitiateUpload to upload new attachments.
     */
    getAttachmentsFolder: async (request: PartialMessage<GetAttachmentsFolderRequest>) => {
        return attachmentsClient.getAttachmentsFolder(request);
    },
};
