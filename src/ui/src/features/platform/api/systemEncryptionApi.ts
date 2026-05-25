import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    SystemEncryptionService,
    GetDeploymentEncryptionStatusRequestSchema,
    RotateDeploymentDekRequestSchema,
} from '@uniffy/proto/superadmin/v1/system_encryption_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(SystemEncryptionService, transport);

export const systemEncryptionApi = {
    getDeploymentEncryptionStatus: async (
        request: MessageInitShape<typeof GetDeploymentEncryptionStatusRequestSchema> = {},
    ) => client.getDeploymentEncryptionStatus(request),

    rotateDeploymentDek: async (
        request: MessageInitShape<typeof RotateDeploymentDekRequestSchema>,
    ) => client.rotateDeploymentDek(request),
};
