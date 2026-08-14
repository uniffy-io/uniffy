import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
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
  GetOrgCallPolicyRequestSchema,
  UpdateOrgCallPolicyRequestSchema,
} from "@uniffy/proto/calls/v1/calls_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const callsClient = createClient(CallService, unaryTransport);

export const callsApi = {
  initiateCall: (req: MessageInitShape<typeof InitiateCallRequestSchema>) =>
    callsClient.initiateCall(req),
  joinCall: (req: MessageInitShape<typeof JoinCallRequestSchema>) => callsClient.joinCall(req),
  leaveCall: (req: MessageInitShape<typeof LeaveCallRequestSchema>) => callsClient.leaveCall(req),
  endCall: (req: MessageInitShape<typeof EndCallRequestSchema>) => callsClient.endCall(req),
  refreshCallToken: (req: MessageInitShape<typeof RefreshCallTokenRequestSchema>) =>
    callsClient.refreshCallToken(req),
  getActiveCall: (req: MessageInitShape<typeof GetActiveCallRequestSchema>) =>
    callsClient.getActiveCall(req),
  listActiveCalls: (req: MessageInitShape<typeof ListActiveCallsRequestSchema>) =>
    callsClient.listActiveCalls(req),
  declineCall: (req: MessageInitShape<typeof DeclineCallRequestSchema>) =>
    callsClient.declineCall(req),
  kickParticipant: (req: MessageInitShape<typeof KickParticipantRequestSchema>) =>
    callsClient.kickParticipant(req),
  muteParticipant: (req: MessageInitShape<typeof MuteParticipantRequestSchema>) =>
    callsClient.muteParticipant(req),
  reportMediaState: (req: MessageInitShape<typeof ReportMediaStateRequestSchema>) =>
    callsClient.reportMediaState(req),
  getOrgCallPolicy: (req: MessageInitShape<typeof GetOrgCallPolicyRequestSchema>) =>
    callsClient.getOrgCallPolicy(req),
  updateOrgCallPolicy: (req: MessageInitShape<typeof UpdateOrgCallPolicyRequestSchema>) =>
    callsClient.updateOrgCallPolicy(req),
};
