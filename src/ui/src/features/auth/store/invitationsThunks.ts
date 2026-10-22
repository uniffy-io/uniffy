import { createAsyncThunk, type ThunkAction, type UnknownAction } from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch, RootState } from "@/app/store";
import { getStoreRefOrThrow } from "@/app/storeRef";
import { organizationsApi } from "@/features/auth/api/organizationsApi";
import {
  invitationActionFinished,
  invitationActionStarted,
  invitationRemoved,
  invitationsFailed,
  invitationsLoaded,
  invitationsLoading,
  invitationsReloadFailed,
  summarizeInvitation,
  type PendingInvitation,
} from "@/features/auth/store/invitationsSlice";
import { organizationAdded, summarizeOrganization } from "@/features/auth/store/organizationsSlice";
import { switchOrganization } from "@/features/auth/store/organizationsThunks";

/** The welcome list names the invitation; a mail link carries only its token. */
export type InvitationLookup = { invitationId: string } | { token: string };

export interface AcceptedInvitation {
  organizationId: string;
  organizationName: string;
  slug: string;
}

type InvitationAction<T> = ThunkAction<Promise<T>, RootState, unknown, UnknownAction>;

const thunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}>();

async function loadMyInvitations(dispatch: AppDispatch): Promise<PendingInvitation[]> {
  const response = await organizationsApi.listMyInvitations();
  const items = response.invitations.map(summarizeInvitation);
  dispatch(invitationsLoaded(items));
  return items;
}

const notLoading = (_: void, { getState }: { getState: () => RootState }) =>
  getState().invitations.status !== "loading";

export const fetchMyInvitations = thunk<PendingInvitation[], void>(
  "invitations/fetchMyInvitations",
  async (_, { dispatch, rejectWithValue }) => {
    dispatch(invitationsLoading());
    try {
      return await loadMyInvitations(dispatch);
    } catch (error) {
      dispatch(invitationsFailed());
      return rejectWithValue(error instanceof Error ? error.message : "Failed to load invitations");
    }
  },
  { condition: notLoading },
);

/**
 * Reloads the list for a background refresh (tab return, menu open): a failure keeps the list and
 * its status and resolves with null instead of toasting through errorToastMiddleware.
 */
export const refreshMyInvitationsQuietly = thunk<PendingInvitation[] | null, void>(
  "invitations/refreshMyInvitationsQuietly",
  async (_, { dispatch, getState }) => {
    const previous = getState().invitations.status;
    dispatch(invitationsLoading());
    try {
      return await loadMyInvitations(dispatch);
    } catch {
      dispatch(invitationsReloadFailed(previous));
      return null;
    }
  },
  { condition: notLoading },
);

/**
 * Invitations belong to the user rather than to the tab's organization, so their outcome lands on
 * the store itself: the session scope guard would drop it when a switch ends the scope mid-call.
 */
function storeDispatch(): AppDispatch {
  return getStoreRefOrThrow().dispatch as AppDispatch;
}

/**
 * Joins the organization and switches this tab into it. A refused accept rejects with its
 * ConnectError and no toast, so the caller places the message; a failed switch afterwards rejects
 * with the message the switch already toasted, and the membership stands.
 */
export function acceptInvitation(lookup: InvitationLookup): InvitationAction<AcceptedInvitation> {
  return async (_dispatch, getState) => {
    const dispatch = storeDispatch();
    const userId = getState().auth.user?.id;
    const invitationId = "invitationId" in lookup ? lookup.invitationId : null;
    if (invitationId) dispatch(invitationActionStarted(invitationId));
    let response;
    try {
      response = await organizationsApi.acceptMyInvitation({
        lookup:
          "invitationId" in lookup
            ? { case: "invitationId", value: lookup.invitationId }
            : { case: "token", value: lookup.token },
      });
    } finally {
      if (invitationId) dispatch(invitationActionFinished());
    }

    const joined = response.organization ? summarizeOrganization(response.organization) : null;
    if (!joined?.id || !joined.slug) {
      throw new ConnectError("The joined organization was not returned", Code.Internal);
    }
    // The account signed out or changed while the call was out; its lists are gone already.
    if (!userId || getState().auth.user?.id !== userId) {
      throw new ConnectError(
        "The session changed before the invitation was accepted",
        Code.Unauthenticated,
      );
    }

    // Any other invitation from the same organization is moot once the user belongs to it.
    for (const item of getState().invitations.items) {
      if (item.id === invitationId || item.organizationId === joined.id) {
        dispatch(invitationRemoved(item.id));
      }
    }
    dispatch(organizationAdded(joined));
    await dispatch(switchOrganization(joined.slug));
    return { organizationId: joined.id, organizationName: joined.name, slug: joined.slug };
  };
}

/** Rejects with the refusal's ConnectError and no toast, like an accept. */
export function declineInvitation({
  invitationId,
}: {
  invitationId: string;
}): InvitationAction<void> {
  return async () => {
    const dispatch = storeDispatch();
    dispatch(invitationActionStarted(invitationId));
    try {
      await organizationsApi.declineMyInvitation({ invitationId });
      dispatch(invitationRemoved(invitationId));
    } finally {
      dispatch(invitationActionFinished());
    }
  };
}
