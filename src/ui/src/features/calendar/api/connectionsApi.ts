import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { unaryTransport } from "@/config/api";
import {
  CalendarConnectionsService,
  CompleteCalendarConnectionRequestSchema,
  DisconnectCalendarConnectionRequestSchema,
  GetCalendarProviderSettingsRequestSchema,
  ListCalendarConnectionsRequestSchema,
  PauseCalendarConnectionRequestSchema,
  ResumeCalendarConnectionRequestSchema,
  StartCalendarConnectionRequestSchema,
  SyncCalendarConnectionNowRequestSchema,
  UpdateCalendarProviderSettingsRequestSchema,
  UpdateConnectedCalendarRequestSchema,
} from "@uniffy/proto/cal/v1/connections_pb";

const connectionsClient = createClient(CalendarConnectionsService, unaryTransport);

export const connectionsApi = {
  listCalendarConnections: (
    request: MessageInitShape<typeof ListCalendarConnectionsRequestSchema>,
  ) => connectionsClient.listCalendarConnections(request),

  startCalendarConnection: (
    request: MessageInitShape<typeof StartCalendarConnectionRequestSchema>,
  ) => connectionsClient.startCalendarConnection(request),

  completeCalendarConnection: (
    request: MessageInitShape<typeof CompleteCalendarConnectionRequestSchema>,
  ) => connectionsClient.completeCalendarConnection(request),

  updateConnectedCalendar: (
    request: MessageInitShape<typeof UpdateConnectedCalendarRequestSchema>,
  ) => connectionsClient.updateConnectedCalendar(request),

  pauseCalendarConnection: (
    request: MessageInitShape<typeof PauseCalendarConnectionRequestSchema>,
  ) => connectionsClient.pauseCalendarConnection(request),

  resumeCalendarConnection: (
    request: MessageInitShape<typeof ResumeCalendarConnectionRequestSchema>,
  ) => connectionsClient.resumeCalendarConnection(request),

  disconnectCalendarConnection: (
    request: MessageInitShape<typeof DisconnectCalendarConnectionRequestSchema>,
  ) => connectionsClient.disconnectCalendarConnection(request),

  syncCalendarConnectionNow: (
    request: MessageInitShape<typeof SyncCalendarConnectionNowRequestSchema>,
  ) => connectionsClient.syncCalendarConnectionNow(request),

  getCalendarProviderSettings: (
    request: MessageInitShape<typeof GetCalendarProviderSettingsRequestSchema>,
  ) => connectionsClient.getCalendarProviderSettings(request),

  updateCalendarProviderSettings: (
    request: MessageInitShape<typeof UpdateCalendarProviderSettingsRequestSchema>,
  ) => connectionsClient.updateCalendarProviderSettings(request),
};
