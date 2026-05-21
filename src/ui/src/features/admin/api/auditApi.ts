/**
 * Audit API Service
 *
 * Wraps audit.v1.AuditService. ListEvents is unary (uses unaryTransport).
 * ExportEvents is server-streaming so it uses the no-timeout transport.
 */

import { createClient } from '@connectrpc/connect';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { transport, unaryTransport } from '@/config/api';
import {
    AuditService,
    type ListEventsRequestSchema,
    type ExportEventsRequestSchema,
} from '@uniffy/proto/audit/v1/audit_pb';

const auditClient = createClient(AuditService, unaryTransport);
const auditStreamClient = createClient(AuditService, transport);

export const auditApi = {
    listEvents: async (request: MessageInitShape<typeof ListEventsRequestSchema>) => {
        return auditClient.listEvents(request);
    },

    exportEvents: (request: MessageInitShape<typeof ExportEventsRequestSchema>) => {
        return auditStreamClient.exportEvents(request);
    },
};
