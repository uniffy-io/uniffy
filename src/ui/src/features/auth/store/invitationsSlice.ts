import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type { MyInvitation } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { RootState } from "@/app/store";
import { AUTH_ACTION_TYPES, resetOrganizationScope } from "@/features/auth/store/authActions";

export interface PendingInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  inviterDisplayName: string | null;
  expiresAt: string;
  createdAt: string;
}

export type InvitationsStatus = "idle" | "loading" | "ready" | "error";

export interface InvitationsState {
  items: PendingInvitation[];
  status: InvitationsStatus;
  /** The invitation an accept or decline is running for. */
  actingId: string | null;
}

const initialState: InvitationsState = {
  items: [],
  status: "idle",
  actingId: null,
};

export function summarizeInvitation(proto: MyInvitation): PendingInvitation {
  return {
    id: proto.id,
    organizationId: proto.organization?.id ?? "",
    organizationName: proto.organization?.name ?? "",
    organizationSlug: proto.organization?.slug ?? "",
    role: proto.role,
    inviterDisplayName: proto.inviterDisplayName || null,
    expiresAt: proto.expiresAt ? timestampDate(proto.expiresAt).toISOString() : "",
    createdAt: proto.createdAt ? timestampDate(proto.createdAt).toISOString() : "",
  };
}

export const invitationsSlice = createSlice({
  name: "invitations",
  initialState,
  reducers: {
    invitationsLoading: (state) => {
      state.status = "loading";
    },
    invitationsLoaded: (state, action: PayloadAction<PendingInvitation[]>) => {
      state.items = action.payload;
      state.status = "ready";
    },
    // A failed reload keeps the last good list, so a row the user is about to act on stays put.
    invitationsFailed: (state) => {
      state.status = "error";
    },
    // A background reload that failed puts back the status it found, so it shows no error.
    invitationsReloadFailed: (state, action: PayloadAction<InvitationsStatus>) => {
      state.status = action.payload;
    },
    invitationActionStarted: (state, action: PayloadAction<string>) => {
      state.actingId = action.payload;
    },
    invitationActionFinished: (state) => {
      state.actingId = null;
    },
    invitationRemoved: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((item) => item.id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    // Invitations are addressed to the signed-in user; the next account starts from nothing.
    builder.addCase(AUTH_ACTION_TYPES.LOGOUT, () => initialState);
    builder.addCase(AUTH_ACTION_TYPES.REHYDRATE_FAILED, () => initialState);
    // A switch keeps the list but aborts work in flight and drops its later dispatches, so a load
    // or an action it interrupted would otherwise never settle.
    builder.addCase(resetOrganizationScope, (state) => {
      if (state.status === "loading") state.status = "idle";
      state.actingId = null;
    });
  },
});

export const {
  invitationsLoading,
  invitationsLoaded,
  invitationsFailed,
  invitationsReloadFailed,
  invitationActionStarted,
  invitationActionFinished,
  invitationRemoved,
} = invitationsSlice.actions;
export const invitationsReducer = invitationsSlice.reducer;

type InvitationsRootState = Pick<RootState, "invitations">;

export const selectPendingInvitations = (state: InvitationsRootState) => state.invitations.items;
export const selectPendingInvitationsStatus = (state: InvitationsRootState) =>
  state.invitations.status;
export const selectInvitationActingId = (state: InvitationsRootState) => state.invitations.actingId;
export const selectPendingInvitationCount = (state: InvitationsRootState): number =>
  state.invitations.items.length;
