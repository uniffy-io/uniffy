/**
 * Per-org security settings API.
 *
 * Thin ConnectRPC wrapper over `OrganizationsService.{Get,Update}SecuritySettings`.
 * One setting today (password reset toggle); MFA enforcement, SSO, session
 * policy will land as new fields on the same `SecuritySettings` message.
 */

import { createClient } from '@connectrpc/connect';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';
import {
    OrganizationsService,
    GetSecuritySettingsRequestSchema,
    UpdateSecuritySettingsRequestSchema,
} from '@uniffy/proto/organizations/v1/organizations_pb';

const client = createClient(OrganizationsService, unaryTransport);

export const securityApi = {
    get: async (request: MessageInitShape<typeof GetSecuritySettingsRequestSchema>) =>
        client.getSecuritySettings(request),

    update: async (request: MessageInitShape<typeof UpdateSecuritySettingsRequestSchema>) =>
        client.updateSecuritySettings(request),
};
