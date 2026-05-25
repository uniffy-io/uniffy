import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    PlatformAuditService,
    ListPlatformActionsRequestSchema,
    ListPlatformAuditRequestSchema,
} from '@uniffy/proto/superadmin/v1/platform_audit_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(PlatformAuditService, transport);

export const platformAuditApi = {
    listEvents: async (request: MessageInitShape<typeof ListPlatformAuditRequestSchema>) =>
        client.listPlatformAudit(request),

    listActions: async (
        request: MessageInitShape<typeof ListPlatformActionsRequestSchema> = {},
    ) => client.listPlatformActions(request),
};
