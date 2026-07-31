import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    GetRuntimeSettingsRequestSchema,
    RuntimeSettingsService,
    UpdateRuntimeSettingsRequestSchema,
} from '@uniffy/proto/agents/v1/runtime_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(RuntimeSettingsService, transport);

export const agentRuntimeSettingsApi = {
    getRuntimeSettings: (req: MessageInitShape<typeof GetRuntimeSettingsRequestSchema>) =>
        client.getRuntimeSettings(req),
    updateRuntimeSettings: (req: MessageInitShape<typeof UpdateRuntimeSettingsRequestSchema>) =>
        client.updateRuntimeSettings(req),
};
