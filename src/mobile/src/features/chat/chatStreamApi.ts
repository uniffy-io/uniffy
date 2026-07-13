import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  ChatStreamService,
  StreamUserChatEventsRequestSchema,
} from "@uniffy/proto/chat/v1/chat_stream_pb";
import { streamTransport } from "@core/api/streamTransport";

const client = createClient(ChatStreamService, streamTransport);

export const chatStreamApi = {
  streamUserChatEvents: (
    req: MessageInitShape<typeof StreamUserChatEventsRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.streamUserChatEvents(req, options),
};
