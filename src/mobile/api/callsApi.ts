import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  CallService,
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
  ReportMediaStateRequestSchema,
} from "@uniffy/proto/calls/v1/calls_pb";
import { transport } from "@/lib/transport";

const client = createClient(CallService, transport);

export const callsApi = {
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
  reportMediaState: (req: MessageInitShape<typeof ReportMediaStateRequestSchema>) =>
    client.reportMediaState(req),
};
