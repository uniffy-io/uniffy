import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  AccessRequestState,
  RequestAccessOutcome,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import { clearPermissions } from "@/features/permissions/store/permissionsSlice";
import {
  cancelAccessRequest,
  fetchAccessRequest,
  fetchMyAccessRequestStatuses,
  listAccessRequests,
  requestContentAccess,
  respondToAccessRequest,
} from "@/features/permissions/store/accessRequestThunks";

export interface SerializedAccessRequest {
  id: string;
  organizationId: string;
  requestedUrn: string;
  originalContentType: number;
  originalContentId: string;
  canonicalContentType: number;
  canonicalContentId: string;
  requesterId: string;
  requesterDisplayName: string;
  state: AccessRequestState;
  message: string;
  decisionNote: string;
  approvedRole: number | null;
  respondedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  respondedAt: string | null;
  canRequestAgainAt: string | null;
  requesterHasAccess: boolean;
}

export interface AccessRequestStatusRecord {
  requestedUrn: string;
  state: AccessRequestState;
  requestId: string | null;
  canRequestAgainAt: string | null;
  requesterHasAccess: boolean;
}

export interface RequestAccessDialogTarget {
  urn: string;
  label: string;
  canRequestAccess: boolean;
  state?: AccessRequestState;
  requestId?: string;
  canRequestAgainAt?: string;
}

export interface AccessRequestListEntry {
  ids: string[];
  loading: boolean;
  error: string | null;
  nextPage: number | null;
}

export interface AccessRequestsState {
  byUrn: Record<string, AccessRequestStatusRecord>;
  byId: Record<string, SerializedAccessRequest>;
  requestDialog: RequestAccessDialogTarget | null;
  reviewDialogRequestId: string | null;
  requestingByUrn: Record<string, boolean>;
  requestErrorsByUrn: Record<string, string | null>;
  loadingById: Record<string, boolean>;
  errorsById: Record<string, string | null>;
  respondingById: Record<string, boolean>;
  listsByTarget: Record<string, AccessRequestListEntry>;
}

const initialState: AccessRequestsState = {
  byUrn: {},
  byId: {},
  requestDialog: null,
  reviewDialogRequestId: null,
  requestingByUrn: {},
  requestErrorsByUrn: {},
  loadingById: {},
  errorsById: {},
  respondingById: {},
  listsByTarget: {},
};

function statusFromRequest(request: SerializedAccessRequest): AccessRequestStatusRecord {
  return {
    requestedUrn: request.requestedUrn,
    state: request.state,
    requestId: request.id,
    canRequestAgainAt: request.canRequestAgainAt,
    requesterHasAccess: request.requesterHasAccess,
  };
}

function storeRequest(state: AccessRequestsState, request: SerializedAccessRequest): void {
  state.byId[request.id] = request;
  state.byUrn[request.requestedUrn] = statusFromRequest(request);
}

const accessRequestsSlice = createSlice({
  name: "accessRequests",
  initialState,
  reducers: {
    openRequestAccessDialog: (state, action: PayloadAction<RequestAccessDialogTarget>) => {
      state.requestDialog = action.payload;
      state.reviewDialogRequestId = null;
      state.requestErrorsByUrn[action.payload.urn] = null;
      if (action.payload.state !== undefined) {
        state.byUrn[action.payload.urn] = {
          requestedUrn: action.payload.urn,
          state: action.payload.state,
          requestId: action.payload.requestId ?? null,
          canRequestAgainAt: action.payload.canRequestAgainAt ?? null,
          requesterHasAccess: false,
        };
      }
    },
    closeRequestAccessDialog: (state) => {
      state.requestDialog = null;
    },
    openAccessRequestReviewDialog: (state, action: PayloadAction<string>) => {
      state.reviewDialogRequestId = action.payload;
      state.requestDialog = null;
      state.errorsById[action.payload] = null;
    },
    closeAccessRequestReviewDialog: (state) => {
      state.reviewDialogRequestId = null;
    },
    applyAccessRequestState: (state, action: PayloadAction<AccessRequestStatusRecord>) => {
      state.byUrn[action.payload.requestedUrn] = action.payload;
      const requestId = action.payload.requestId;
      if (requestId && state.byId[requestId]) {
        state.byId[requestId].state = action.payload.state;
        state.byId[requestId].canRequestAgainAt = action.payload.canRequestAgainAt;
        state.byId[requestId].requesterHasAccess = action.payload.requesterHasAccess;
      }
    },
    clearAccessRequestError: (state, action: PayloadAction<string>) => {
      state.requestErrorsByUrn[action.payload] = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(clearPermissions, () => initialState)
      .addCase(requestContentAccess.pending, (state, action) => {
        const urn = action.meta.arg.requestedUrn;
        state.requestingByUrn[urn] = true;
        state.requestErrorsByUrn[urn] = null;
      })
      .addCase(requestContentAccess.fulfilled, (state, action) => {
        const { requestedUrn, outcome, accessRequest, canRequestAgainAt } = action.payload;
        state.requestingByUrn[requestedUrn] = false;
        if (accessRequest) {
          storeRequest(state, accessRequest);
        } else if (outcome === RequestAccessOutcome.COOLDOWN) {
          state.byUrn[requestedUrn] = {
            requestedUrn,
            state: AccessRequestState.DENIED,
            requestId: null,
            canRequestAgainAt,
            requesterHasAccess: false,
          };
        } else if (outcome === RequestAccessOutcome.ALREADY_ACCESSIBLE) {
          state.byUrn[requestedUrn] = {
            requestedUrn,
            state: AccessRequestState.APPROVED,
            requestId: null,
            canRequestAgainAt: null,
            requesterHasAccess: true,
          };
        }
      })
      .addCase(requestContentAccess.rejected, (state, action) => {
        const urn = action.meta.arg.requestedUrn;
        state.requestingByUrn[urn] = false;
        state.requestErrorsByUrn[urn] =
          (action.payload as string | undefined) ?? "Failed to request access";
      })
      .addCase(fetchMyAccessRequestStatuses.fulfilled, (state, action) => {
        for (const status of action.payload) state.byUrn[status.requestedUrn] = status;
      })
      .addCase(fetchAccessRequest.pending, (state, action) => {
        const requestId = action.meta.arg.requestId;
        state.loadingById[requestId] = true;
        state.errorsById[requestId] = null;
      })
      .addCase(fetchAccessRequest.fulfilled, (state, action) => {
        state.loadingById[action.meta.arg.requestId] = false;
        storeRequest(state, action.payload);
      })
      .addCase(fetchAccessRequest.rejected, (state, action) => {
        const requestId = action.meta.arg.requestId;
        state.loadingById[requestId] = false;
        state.errorsById[requestId] =
          (action.payload as string | undefined) ?? "Failed to load access request";
      })
      .addCase(listAccessRequests.pending, (state, action) => {
        const key = `${action.meta.arg.canonicalContentType}:${action.meta.arg.canonicalContentId}`;
        const existing = state.listsByTarget[key];
        state.listsByTarget[key] = {
          ids: existing?.ids ?? [],
          loading: true,
          error: null,
          nextPage: existing?.nextPage ?? null,
        };
      })
      .addCase(listAccessRequests.fulfilled, (state, action) => {
        const page = action.meta.arg.page ?? 1;
        const ids = action.payload.requests.map((request) => {
          storeRequest(state, request);
          return request.id;
        });
        const existingIds = state.listsByTarget[action.payload.targetKey]?.ids ?? [];
        state.listsByTarget[action.payload.targetKey] = {
          ids: page <= 1 ? ids : [...existingIds, ...ids],
          loading: false,
          error: null,
          nextPage: action.payload.nextPage,
        };
      })
      .addCase(listAccessRequests.rejected, (state, action) => {
        const key = `${action.meta.arg.canonicalContentType}:${action.meta.arg.canonicalContentId}`;
        const existing = state.listsByTarget[key];
        state.listsByTarget[key] = {
          ids: existing?.ids ?? [],
          loading: false,
          error: (action.payload as string | undefined) ?? "Failed to load access requests",
          nextPage: existing?.nextPage ?? null,
        };
      })
      .addCase(respondToAccessRequest.pending, (state, action) => {
        state.respondingById[action.meta.arg.requestId] = true;
        state.errorsById[action.meta.arg.requestId] = null;
      })
      .addCase(respondToAccessRequest.fulfilled, (state, action) => {
        state.respondingById[action.meta.arg.requestId] = false;
        storeRequest(state, action.payload);
      })
      .addCase(respondToAccessRequest.rejected, (state, action) => {
        const requestId = action.meta.arg.requestId;
        state.respondingById[requestId] = false;
        state.errorsById[requestId] =
          (action.payload as string | undefined) ?? "Failed to respond to access request";
      })
      .addCase(cancelAccessRequest.pending, (state, action) => {
        state.respondingById[action.meta.arg.requestId] = true;
      })
      .addCase(cancelAccessRequest.fulfilled, (state, action) => {
        state.respondingById[action.meta.arg.requestId] = false;
        storeRequest(state, action.payload);
      })
      .addCase(cancelAccessRequest.rejected, (state, action) => {
        const requestId = action.meta.arg.requestId;
        state.respondingById[requestId] = false;
        state.errorsById[requestId] =
          (action.payload as string | undefined) ?? "Failed to cancel access request";
      });
  },
});

export const {
  openRequestAccessDialog,
  closeRequestAccessDialog,
  openAccessRequestReviewDialog,
  closeAccessRequestReviewDialog,
  applyAccessRequestState,
  clearAccessRequestError,
} = accessRequestsSlice.actions;
export const accessRequestsReducer = accessRequestsSlice.reducer;
