import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ListMessagesRequestSchema, SessionsService } from "@uniffy/proto/agents/v1/sessions_pb";
import { transport } from "@core/api/transport";

const client = createClient(SessionsService, transport);

/** Read-only access to background agent sessions; the server only answers their owner. */
export const sessionsApi = {
  listMessages: (req: MessageInitShape<typeof ListMessagesRequestSchema>) =>
    client.listMessages(req),
};
