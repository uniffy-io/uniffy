import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  NotificationsService,
  StreamNotificationsRequestSchema,
} from "@uniffy/proto/notifications/v1/notifications_pb";
import { streamTransport } from "@core/api/streamTransport";

const client = createClient(NotificationsService, streamTransport);

export const notificationStreamApi = {
  streamNotifications: (
    req: MessageInitShape<typeof StreamNotificationsRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.streamNotifications(req, options),
};
