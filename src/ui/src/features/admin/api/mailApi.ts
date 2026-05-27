import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    OrgMailService,
    ClearMailConfigRequestSchema,
    GetMailConfigRequestSchema,
    SendTestMailRequestSchema,
    UpdateMailConfigRequestSchema,
} from '@uniffy/proto/mail/v1/mail_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(OrgMailService, transport);

export const mailApi = {
    getMailConfig: async (
        request: MessageInitShape<typeof GetMailConfigRequestSchema>,
    ) => client.getMailConfig(request),

    updateMailConfig: async (
        request: MessageInitShape<typeof UpdateMailConfigRequestSchema>,
    ) => client.updateMailConfig(request),

    clearMailConfig: async (
        request: MessageInitShape<typeof ClearMailConfigRequestSchema>,
    ) => client.clearMailConfig(request),

    sendTestMail: async (
        request: MessageInitShape<typeof SendTestMailRequestSchema>,
    ) => client.sendTestMail(request),
};
