import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    SystemMailService,
    ClearSystemMailConfigRequestSchema,
    ForceClearOrgConfigRequestSchema,
    GetSystemMailConfigRequestSchema,
    ListGlobalDeliveriesRequestSchema,
    ListGlobalSuppressionsRequestSchema,
    ListOrgMailConfigsRequestSchema,
    RemoveGlobalSuppressionRequestSchema,
    UpdateSystemMailConfigRequestSchema,
} from '@uniffy/proto/superadmin/v1/system_mail_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(SystemMailService, transport);

export const systemMailApi = {
    getSystemMailConfig: async (
        request: MessageInitShape<typeof GetSystemMailConfigRequestSchema> = {},
    ) => client.getSystemMailConfig(request),

    updateSystemMailConfig: async (
        request: MessageInitShape<typeof UpdateSystemMailConfigRequestSchema>,
    ) => client.updateSystemMailConfig(request),

    clearSystemMailConfig: async (
        request: MessageInitShape<typeof ClearSystemMailConfigRequestSchema>,
    ) => client.clearSystemMailConfig(request),

    listOrgMailConfigs: async (
        request: MessageInitShape<typeof ListOrgMailConfigsRequestSchema>,
    ) => client.listOrgMailConfigs(request),

    forceClearOrgConfig: async (
        request: MessageInitShape<typeof ForceClearOrgConfigRequestSchema>,
    ) => client.forceClearOrgConfig(request),

    listGlobalSuppressions: async (
        request: MessageInitShape<typeof ListGlobalSuppressionsRequestSchema>,
    ) => client.listGlobalSuppressions(request),

    removeGlobalSuppression: async (
        request: MessageInitShape<typeof RemoveGlobalSuppressionRequestSchema>,
    ) => client.removeGlobalSuppression(request),

    listGlobalDeliveries: async (
        request: MessageInitShape<typeof ListGlobalDeliveriesRequestSchema>,
    ) => client.listGlobalDeliveries(request),
};
