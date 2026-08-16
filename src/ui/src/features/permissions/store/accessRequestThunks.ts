import { createAsyncThunk } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  ContentRole,
  ContentType,
  PaginationRequestSchema,
} from "@uniffy/proto/common/v1/common_pb";
import {
  AccessRequestDecision,
  AccessRequestState,
  RequestAccessOutcome,
  type AccessRequestStatus,
  type ContentAccessRequest,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import type { RootState } from "@/app/store";
import { accessRequestStateToLiveState } from "@/components/mention/accessRequestState";
import { mergeMentionState } from "@/components/mention/mentionStateEmitter";
import { resolveUrnBatched } from "@/components/mention/useBatchedSubjectResolver";
import { membersApi } from "@/features/permissions/api/membersApi";
import type {
  AccessRequestStatusRecord,
  SerializedAccessRequest,
} from "@/features/permissions/store/accessRequestsSlice";

function timestampToIso(timestamp: Timestamp | undefined): string | null {
  return timestamp ? timestampDate(timestamp).toISOString() : null;
}

export function serializeAccessRequest(request: ContentAccessRequest): SerializedAccessRequest {
  return {
    id: request.id,
    organizationId: request.organizationId,
    requestedUrn: request.requestedUrn,
    originalContentType: request.originalContentType,
    originalContentId: request.originalContentId,
    canonicalContentType: request.canonicalContentType,
    canonicalContentId: request.canonicalContentId,
    requesterId: request.requesterId,
    requesterDisplayName: request.requesterDisplayName,
    state: request.state,
    message: request.message,
    decisionNote: request.decisionNote,
    approvedRole: request.approvedRole ?? null,
    respondedByUserId: request.respondedByUserId ?? null,
    createdAt: timestampToIso(request.createdAt),
    updatedAt: timestampToIso(request.updatedAt),
    respondedAt: timestampToIso(request.respondedAt),
    canRequestAgainAt: timestampToIso(request.canRequestAgainAt),
    requesterHasAccess: request.requesterHasAccess,
  };
}

function serializeStatus(status: AccessRequestStatus): AccessRequestStatusRecord {
  return {
    requestedUrn: status.requestedUrn,
    state: status.state,
    requestId: status.requestId ?? null,
    canRequestAgainAt: timestampToIso(status.canRequestAgainAt),
    requesterHasAccess: status.requesterHasAccess,
  };
}

function getOrganizationId(getState: () => RootState): string | null {
  return getState().auth.currentOrganizationId ?? null;
}

function rejectMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function publishStatus(status: AccessRequestStatusRecord): void {
  mergeMentionState(
    status.requestedUrn,
    accessRequestStateToLiveState(
      status.state,
      status.requestId ?? undefined,
      status.canRequestAgainAt ?? undefined,
    ),
  );
}

export interface RequestContentAccessArgs {
  requestedUrn: string;
  message?: string;
}

export const requestContentAccess = createAsyncThunk<
  {
    requestedUrn: string;
    outcome: RequestAccessOutcome;
    accessRequest: SerializedAccessRequest | null;
    canRequestAgainAt: string | null;
  },
  RequestContentAccessArgs,
  { state: RootState; rejectValue: string }
>("accessRequests/request", async (args, { getState, rejectWithValue }) => {
  const organizationId = getOrganizationId(getState);
  if (!organizationId) return rejectWithValue("No organization selected");

  try {
    const response = await membersApi.requestAccess({
      organizationId,
      requestedUrn: args.requestedUrn,
      message: args.message?.trim() ?? "",
    });
    const accessRequest = response.accessRequest
      ? serializeAccessRequest(response.accessRequest)
      : null;
    const canRequestAgainAt = timestampToIso(response.canRequestAgainAt);

    if (accessRequest) {
      publishStatus({
        requestedUrn: accessRequest.requestedUrn,
        state: accessRequest.state,
        requestId: accessRequest.id,
        canRequestAgainAt: accessRequest.canRequestAgainAt,
        requesterHasAccess: accessRequest.requesterHasAccess,
      });
    } else if (response.outcome === RequestAccessOutcome.COOLDOWN) {
      mergeMentionState(
        args.requestedUrn,
        accessRequestStateToLiveState(
          AccessRequestState.DENIED,
          undefined,
          canRequestAgainAt ?? undefined,
        ),
      );
    } else if (response.outcome === RequestAccessOutcome.ALREADY_ACCESSIBLE) {
      await resolveUrnBatched(args.requestedUrn, organizationId, { force: true });
    }

    return {
      requestedUrn: args.requestedUrn,
      outcome: response.outcome,
      accessRequest,
      canRequestAgainAt,
    };
  } catch (error) {
    return rejectWithValue(rejectMessage(error, "Failed to request access"));
  }
});

export const fetchMyAccessRequestStatuses = createAsyncThunk<
  AccessRequestStatusRecord[],
  { requestedUrns: string[] },
  { state: RootState; rejectValue: string }
>("accessRequests/fetchMyStatuses", async ({ requestedUrns }, { getState, rejectWithValue }) => {
  const organizationId = getOrganizationId(getState);
  if (!organizationId) return rejectWithValue("No organization selected");
  if (requestedUrns.length === 0) return [];

  try {
    const response = await membersApi.getMyAccessRequestStatuses({
      organizationId,
      requestedUrns,
    });
    const statuses = response.statuses.map(serializeStatus);
    statuses.forEach(publishStatus);
    return statuses;
  } catch (error) {
    return rejectWithValue(rejectMessage(error, "Failed to load access request status"));
  }
});

export const fetchAccessRequest = createAsyncThunk<
  SerializedAccessRequest,
  { requestId: string },
  { state: RootState; rejectValue: string }
>("accessRequests/fetchOne", async ({ requestId }, { getState, rejectWithValue }) => {
  const organizationId = getOrganizationId(getState);
  if (!organizationId) return rejectWithValue("No organization selected");

  try {
    const response = await membersApi.getAccessRequest({ organizationId, requestId });
    if (!response.accessRequest) return rejectWithValue("Access request was not found");
    return serializeAccessRequest(response.accessRequest);
  } catch (error) {
    return rejectWithValue(rejectMessage(error, "Failed to load access request"));
  }
});

export interface ListAccessRequestsArgs {
  canonicalContentType: ContentType;
  canonicalContentId: string;
  state?: AccessRequestState;
  page?: number;
  pageSize?: number;
}

export const listAccessRequests = createAsyncThunk<
  { targetKey: string; requests: SerializedAccessRequest[]; nextPage: number | null },
  ListAccessRequestsArgs,
  { state: RootState; rejectValue: string }
>("accessRequests/list", async (args, { getState, rejectWithValue }) => {
  const organizationId = getOrganizationId(getState);
  if (!organizationId) return rejectWithValue("No organization selected");

  const page = args.page ?? 1;
  const pageSize = args.pageSize ?? 10;
  const targetKey = `${args.canonicalContentType}:${args.canonicalContentId}`;
  try {
    const response = await membersApi.listAccessRequests({
      organizationId,
      canonicalContentType: args.canonicalContentType,
      canonicalContentId: args.canonicalContentId,
      state: args.state,
      pagination: create(PaginationRequestSchema, { page, pageSize }),
    });
    const totalPages = response.pagination?.totalPages ?? 0;
    return {
      targetKey,
      requests: response.accessRequests.map(serializeAccessRequest),
      nextPage: page < totalPages ? page + 1 : null,
    };
  } catch (error) {
    return rejectWithValue(rejectMessage(error, "Failed to load access requests"));
  }
});

export interface RespondToAccessRequestArgs {
  requestId: string;
  decision: AccessRequestDecision;
  approvedRole?: ContentRole;
  decisionNote?: string;
}

export const respondToAccessRequest = createAsyncThunk<
  SerializedAccessRequest,
  RespondToAccessRequestArgs,
  { state: RootState; rejectValue: string }
>("accessRequests/respond", async (args, { getState, rejectWithValue }) => {
  const organizationId = getOrganizationId(getState);
  if (!organizationId) return rejectWithValue("No organization selected");

  try {
    const response = await membersApi.respondToAccessRequest({
      organizationId,
      requestId: args.requestId,
      decision: args.decision,
      approvedRole: args.approvedRole,
      decisionNote: args.decisionNote?.trim() ?? "",
    });
    if (!response.accessRequest) return rejectWithValue("Access request was not found");
    return serializeAccessRequest(response.accessRequest);
  } catch (error) {
    return rejectWithValue(rejectMessage(error, "Failed to respond to access request"));
  }
});

export const cancelAccessRequest = createAsyncThunk<
  SerializedAccessRequest,
  { requestId: string },
  { state: RootState; rejectValue: string }
>("accessRequests/cancel", async ({ requestId }, { getState, rejectWithValue }) => {
  const organizationId = getOrganizationId(getState);
  if (!organizationId) return rejectWithValue("No organization selected");

  try {
    const response = await membersApi.cancelAccessRequest({ organizationId, requestId });
    if (!response.accessRequest) return rejectWithValue("Access request was not found");
    const accessRequest = serializeAccessRequest(response.accessRequest);
    publishStatus({
      requestedUrn: accessRequest.requestedUrn,
      state: accessRequest.state,
      requestId: accessRequest.id,
      canRequestAgainAt: accessRequest.canRequestAgainAt,
      requesterHasAccess: accessRequest.requesterHasAccess,
    });
    return accessRequest;
  } catch (error) {
    return rejectWithValue(rejectMessage(error, "Failed to cancel access request"));
  }
});
