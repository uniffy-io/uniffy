import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AccessRequestState,
  type AccessRequestStatus,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import { MentionAccessRequestStatus, type MentionLiveState } from "@/components/mention/types";

function timestampToIso(timestamp: Timestamp | undefined): string | undefined {
  if (!timestamp) return undefined;
  const millis = Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1_000_000);
  return new Date(millis).toISOString();
}

export function mentionStatusToAccessRequestState(
  status: MentionAccessRequestStatus | undefined,
): AccessRequestState | undefined {
  switch (status) {
    case MentionAccessRequestStatus.Pending:
      return AccessRequestState.PENDING;
    case MentionAccessRequestStatus.Approved:
      return AccessRequestState.APPROVED;
    case MentionAccessRequestStatus.Denied:
      return AccessRequestState.DENIED;
    case MentionAccessRequestStatus.Canceled:
      return AccessRequestState.CANCELED;
    default:
      return undefined;
  }
}

export function accessRequestStatusToLiveState(
  status: AccessRequestStatus | undefined,
): Partial<MentionLiveState> {
  if (!status) return {};
  return accessRequestStateToLiveState(
    status.state,
    status.requestId,
    timestampToIso(status.canRequestAgainAt),
  );
}

export function accessRequestStateToLiveState(
  state: AccessRequestState,
  requestId?: string,
  canRequestAgainAt?: string,
): Partial<MentionLiveState> {
  if (state === AccessRequestState.UNSPECIFIED) return {};

  let accessRequestStatus: MentionAccessRequestStatus;
  switch (state) {
    case AccessRequestState.PENDING:
      accessRequestStatus = MentionAccessRequestStatus.Pending;
      break;
    case AccessRequestState.APPROVED:
      accessRequestStatus = MentionAccessRequestStatus.Approved;
      break;
    case AccessRequestState.DENIED:
      accessRequestStatus = MentionAccessRequestStatus.Denied;
      break;
    case AccessRequestState.CANCELED:
      accessRequestStatus = MentionAccessRequestStatus.Canceled;
      break;
    default:
      return {};
  }

  return {
    accessRequestId: requestId,
    accessRequestStatus,
    canRequestAgainAt,
  };
}
