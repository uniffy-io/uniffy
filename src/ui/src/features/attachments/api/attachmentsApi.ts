import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { AttachmentsService, AttachFileRequestSchema, BatchListAttachmentsRequestSchema, DetachFileRequestSchema, GetAttachmentsFolderRequestSchema, ListAttachmentsRequestSchema, ListSharedAttachmentsRequestSchema } from '@uniffy/proto/attachments/v1/attachments_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const attachmentsClient = createClient(AttachmentsService, unaryTransport);

export const attachmentsApi = {
    /** Attaches a file to content; copies into the user's Attachments folder if not already there. */
    attachFile: async (request: MessageInitShape<typeof AttachFileRequestSchema>) => {
        return attachmentsClient.attachFile(request);
    },

    /** Detaches and deletes the underlying file. */
    detachFile: async (request: MessageInitShape<typeof DetachFileRequestSchema>) => {
        return attachmentsClient.detachFile(request);
    },

    listAttachments: async (request: MessageInitShape<typeof ListAttachmentsRequestSchema>) => {
        return attachmentsClient.listAttachments(request);
    },

    /** Hot-path batched fetch (e.g. chat channel open) - avoids N parallel `listAttachments` calls. */
    batchListAttachments: async (request: MessageInitShape<typeof BatchListAttachmentsRequestSchema>) => {
        return attachmentsClient.batchListAttachments(request);
    },

    listSharedAttachments: async (request: MessageInitShape<typeof ListSharedAttachmentsRequestSchema>) => {
        return attachmentsClient.listSharedAttachments(request);
    },

    /** Returns the folder_id used with FilesService.InitiateUpload for new attachments. */
    getAttachmentsFolder: async (request: MessageInitShape<typeof GetAttachmentsFolderRequestSchema>) => {
        return attachmentsClient.getAttachmentsFolder(request);
    },
};
