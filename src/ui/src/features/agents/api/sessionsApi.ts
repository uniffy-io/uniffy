import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  CreateSessionRequestSchema,
  EditMessageRequestSchema,
  GetSessionRequestSchema,
  ListMessagesRequestSchema,
  RetryMessageRequestSchema,
  SessionsService,
  SubmitMessageFeedbackRequestSchema,
} from "@uniffy/proto/agents/v1/sessions_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(SessionsService, unaryTransport);

export const sessionsApi = {
  createSession: async (request: MessageInitShape<typeof CreateSessionRequestSchema>) => {
    return client.createSession(request);
  },
  getSession: async (request: MessageInitShape<typeof GetSessionRequestSchema>) => {
    return client.getSession(request);
  },
  listMessages: async (request: MessageInitShape<typeof ListMessagesRequestSchema>) => {
    return client.listMessages(request);
  },
  editMessage: async (request: MessageInitShape<typeof EditMessageRequestSchema>) => {
    return client.editMessage(request);
  },
  retryMessage: async (request: MessageInitShape<typeof RetryMessageRequestSchema>) => {
    return client.retryMessage(request);
  },
  submitMessageFeedback: async (
    request: MessageInitShape<typeof SubmitMessageFeedbackRequestSchema>,
  ) => {
    return client.submitMessageFeedback(request);
  },
};
