import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  PresenceService,
  SetPresenceRequestSchema,
  GetBulkPresenceRequestSchema,
} from "@uniffy/proto/presence/v1/presence_pb";
import { transport } from "@/lib/transport";

const client = createClient(PresenceService, transport);

export const presenceApi = {
  setPresence: (req: MessageInitShape<typeof SetPresenceRequestSchema>) => client.setPresence(req),
  getBulkPresence: (req: MessageInitShape<typeof GetBulkPresenceRequestSchema>) =>
    client.getBulkPresence(req),
};
