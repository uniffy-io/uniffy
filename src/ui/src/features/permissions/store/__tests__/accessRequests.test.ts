import { describe, expect, it } from "vitest";
import { AccessMode, ContentRole, ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  AccessRequestDecision,
  AccessRequestState,
  RequestAccessOutcome,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import {
  accessRequestsReducer,
  applyAccessRequestState,
  openRequestAccessDialog,
} from "@/features/permissions/store/accessRequestsSlice";
import {
  cancelAccessRequest,
  requestContentAccess,
  respondToAccessRequest,
} from "@/features/permissions/store/accessRequestThunks";
import {
  clearPermissions,
  permissionsReducer,
} from "@/features/permissions/store/permissionsSlice";
import { fetchContentMembers } from "@/features/permissions/store/permissionsThunks";

const URN = "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca";
const REQUEST_ID = "019fc01f-12b6-7000-bba7-2e7c6de0e775";

function request(state: AccessRequestState) {
  return {
    id: REQUEST_ID,
    organizationId: "org-1",
    requestedUrn: URN,
    originalContentType: 1,
    originalContentId: "note-1",
    canonicalContentType: 1,
    canonicalContentId: "note-1",
    requesterId: "user-1",
    requesterDisplayName: "Reader",
    state,
    message: "Please share this",
    decisionNote: "",
    approvedRole: null,
    respondedByUserId: null,
    createdAt: "2026-08-16T10:00:00.000Z",
    updatedAt: "2026-08-16T10:00:00.000Z",
    respondedAt: null,
    canRequestAgainAt: null,
    requesterHasAccess: false,
  };
}

describe("accessRequestsReducer", () => {
  it("opens the global requester dialog with the chip status", () => {
    const state = accessRequestsReducer(
      undefined,
      openRequestAccessDialog({
        urn: URN,
        label: "Roadmap",
        canRequestAccess: true,
        state: AccessRequestState.PENDING,
        requestId: REQUEST_ID,
      }),
    );

    expect(state.requestDialog).toEqual({
      urn: URN,
      label: "Roadmap",
      canRequestAccess: true,
      state: AccessRequestState.PENDING,
      requestId: REQUEST_ID,
    });
    expect(state.byUrn[URN]).toMatchObject({
      state: AccessRequestState.PENDING,
      requestId: REQUEST_ID,
    });
  });

  it("does not treat a historical approval as current resource access", () => {
    const state = accessRequestsReducer(
      undefined,
      openRequestAccessDialog({
        urn: URN,
        label: "Roadmap",
        canRequestAccess: true,
        state: AccessRequestState.APPROVED,
        requestId: REQUEST_ID,
      }),
    );

    expect(state.byUrn[URN]).toMatchObject({
      state: AccessRequestState.APPROVED,
      requesterHasAccess: false,
    });
  });

  it("stores a duplicate pending response as the canonical request", () => {
    const state = accessRequestsReducer(
      undefined,
      requestContentAccess.fulfilled(
        {
          requestedUrn: URN,
          outcome: RequestAccessOutcome.ALREADY_PENDING,
          accessRequest: request(AccessRequestState.PENDING),
          canRequestAgainAt: null,
        },
        "request-1",
        { requestedUrn: URN },
      ),
    );

    expect(state.byId[REQUEST_ID].state).toBe(AccessRequestState.PENDING);
    expect(state.byUrn[URN]).toMatchObject({
      requestId: REQUEST_ID,
      state: AccessRequestState.PENDING,
    });
  });

  it("stores denial cooldowns even when no request row is returned", () => {
    const canRequestAgainAt = "2026-08-17T10:00:00.000Z";
    const state = accessRequestsReducer(
      undefined,
      requestContentAccess.fulfilled(
        {
          requestedUrn: URN,
          outcome: RequestAccessOutcome.COOLDOWN,
          accessRequest: null,
          canRequestAgainAt,
        },
        "request-1",
        { requestedUrn: URN },
      ),
    );

    expect(state.byUrn[URN]).toEqual({
      requestedUrn: URN,
      state: AccessRequestState.DENIED,
      requestId: null,
      canRequestAgainAt,
      requesterHasAccess: false,
    });
  });

  it("merges realtime decisions and requester cancellation", () => {
    let state = accessRequestsReducer(
      undefined,
      requestContentAccess.fulfilled(
        {
          requestedUrn: URN,
          outcome: RequestAccessOutcome.CREATED,
          accessRequest: request(AccessRequestState.PENDING),
          canRequestAgainAt: null,
        },
        "request-1",
        { requestedUrn: URN },
      ),
    );

    state = accessRequestsReducer(
      state,
      applyAccessRequestState({
        requestedUrn: URN,
        state: AccessRequestState.DENIED,
        requestId: REQUEST_ID,
        canRequestAgainAt: "2026-08-17T10:00:00.000Z",
        requesterHasAccess: false,
      }),
    );
    expect(state.byId[REQUEST_ID].state).toBe(AccessRequestState.DENIED);

    state = accessRequestsReducer(
      state,
      cancelAccessRequest.fulfilled(request(AccessRequestState.CANCELED), "request-2", {
        requestId: REQUEST_ID,
      }),
    );
    expect(state.byUrn[URN].state).toBe(AccessRequestState.CANCELED);
  });

  it("resets request data with the existing permission reset", () => {
    const populated = accessRequestsReducer(
      undefined,
      openRequestAccessDialog({ urn: URN, label: "Roadmap", canRequestAccess: true }),
    );
    const reset = accessRequestsReducer(populated, clearPermissions());

    expect(reset.requestDialog).toBeNull();
    expect(reset.byUrn).toEqual({});
    expect(reset.byId).toEqual({});
  });

  it("invalidates the canonical member list after approval", () => {
    const contentType = ContentType.NOTE;
    const contentId = "note-1";
    let state = permissionsReducer(
      undefined,
      fetchContentMembers.fulfilled(
        {
          policy: {
            ownerId: "owner-1",
            accessMode: AccessMode.EXPLICIT_MEMBERS,
            baselineRole: null,
            callerRole: ContentRole.OWNER,
            effectiveAccessMode: AccessMode.EXPLICIT_MEMBERS,
          },
          members: [],
        },
        "members-1",
        { contentType, contentId },
      ),
    );

    expect(state.byContent[`${contentType}:${contentId}`]).toBeDefined();

    state = permissionsReducer(
      state,
      respondToAccessRequest.fulfilled(request(AccessRequestState.APPROVED), "respond-1", {
        requestId: REQUEST_ID,
        decision: AccessRequestDecision.APPROVE,
        approvedRole: ContentRole.VIEWER,
      }),
    );

    expect(state.byContent[`${contentType}:${contentId}`]).toBeUndefined();
  });
});
