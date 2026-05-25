import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    SystemConfigService,
    GetSystemConfigRequestSchema,
    SetPublicRegistrationRequestSchema,
} from '@uniffy/proto/superadmin/v1/system_config_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(SystemConfigService, transport);

export const systemConfigApi = {
    getSystemConfig: async (
        request: MessageInitShape<typeof GetSystemConfigRequestSchema> = {},
    ) => client.getSystemConfig(request),

    setPublicRegistration: async (
        request: MessageInitShape<typeof SetPublicRegistrationRequestSchema>,
    ) => client.setPublicRegistration(request),
};
