import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  CallService,
  ListCallHistoryRequestSchema,
  GetCallRecordRequestSchema,
  GetCallAvailabilityRequestSchema,
  GetCallStateRequestSchema,
  InitiateCallRequestSchema,
  JoinCallRequestSchema,
  LeaveCallRequestSchema,
  EndCallRequestSchema,
  RefreshCallTokenRequestSchema,
  GetActiveCallRequestSchema,
  ListActiveCallsRequestSchema,
  DeclineCallRequestSchema,
  KickParticipantRequestSchema,
  MuteParticipantRequestSchema,
  ReportCallActivityRequestSchema,
  ReportMediaStateRequestSchema,
  SetHandRaisedRequestSchema,
  SendCallReactionRequestSchema,
} from "@uniffy/proto/calls/v1/calls_pb";
import { transport } from "@core/api/transport";

const client = createClient(CallService, transport);

export const callsApi = {
  reportCallActivity: (req: MessageInitShape<typeof ReportCallActivityRequestSchema>) =>
    client.reportCallActivity(req, { timeoutMs: 10000 }),
  listCallHistory: (
    req: MessageInitShape<typeof ListCallHistoryRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.listCallHistory(req, options),
  getCallRecord: (
    req: MessageInitShape<typeof GetCallRecordRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.getCallRecord(req, options),
  getCallAvailability: (req: MessageInitShape<typeof GetCallAvailabilityRequestSchema>) =>
    client.getCallAvailability(req),
  getCallState: (req: MessageInitShape<typeof GetCallStateRequestSchema>) =>
    client.getCallState(req),
  initiateCall: (req: MessageInitShape<typeof InitiateCallRequestSchema>) =>
    client.initiateCall(req),
  joinCall: (req: MessageInitShape<typeof JoinCallRequestSchema>) => client.joinCall(req),
  leaveCall: (req: MessageInitShape<typeof LeaveCallRequestSchema>) => client.leaveCall(req),
  endCall: (req: MessageInitShape<typeof EndCallRequestSchema>) => client.endCall(req),
  refreshCallToken: (req: MessageInitShape<typeof RefreshCallTokenRequestSchema>) =>
    client.refreshCallToken(req),
  getActiveCall: (req: MessageInitShape<typeof GetActiveCallRequestSchema>) =>
    client.getActiveCall(req),
  listActiveCalls: (req: MessageInitShape<typeof ListActiveCallsRequestSchema>) =>
    client.listActiveCalls(req),
  declineCall: (req: MessageInitShape<typeof DeclineCallRequestSchema>) => client.declineCall(req),
  kickParticipant: (req: MessageInitShape<typeof KickParticipantRequestSchema>) =>
    client.kickParticipant(req),
  muteParticipant: (req: MessageInitShape<typeof MuteParticipantRequestSchema>) =>
    client.muteParticipant(req),
  setHandRaised: (req: MessageInitShape<typeof SetHandRaisedRequestSchema>) =>
    client.setHandRaised(req),
  sendCallReaction: (req: MessageInitShape<typeof SendCallReactionRequestSchema>) =>
    client.sendCallReaction(req),
  reportMediaState: (req: MessageInitShape<typeof ReportMediaStateRequestSchema>) =>
    client.reportMediaState(req),
};
