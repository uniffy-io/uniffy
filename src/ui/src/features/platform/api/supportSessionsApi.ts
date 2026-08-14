import { createClient } from "@connectrpc/connect";
import { transport } from "@/config/api";
import {
  SupportService,
  ListAllSessionsRequestSchema,
  ListMySessionsRequestSchema,
  RequestSessionRequestSchema,
} from "@uniffy/proto/superadmin/v1/support_session_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(SupportService, transport);

export const supportSessionsApi = {
  request: async (request: MessageInitShape<typeof RequestSessionRequestSchema>) =>
    client.requestSession(request),

  listMy: async (request: MessageInitShape<typeof ListMySessionsRequestSchema>) =>
    client.listMySessions(request),

  listAll: async (request: MessageInitShape<typeof ListAllSessionsRequestSchema>) =>
    client.listAllSessions(request),
};
