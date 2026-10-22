import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type { NavigateFunction } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch, RootState } from "@/app/store";
import { getStoreRefOrThrow } from "@/app/storeRef";
import { expectOrganizationLoss, refreshAccessToken } from "@/config/api";
import { adminApi } from "@/features/admin/api/adminApi";
import { leaveCurrentOrganizationScope } from "@/features/auth/components/leaveOrganizationScope";
import { fetchMyOrganizations } from "@/features/auth/store/organizationsThunks";

export interface OrganizationFields {
  name: string;
  slug: string;
}

export interface LoadedOrganization extends OrganizationFields {
  id: string;
}

/** Each rejects with the server's ConnectError and no toast, so the caller places the message. */
type OrganizationAction<T> = ThunkAction<Promise<T>, RootState, undefined, UnknownAction>;

/** Resolves null when the response carries no organization. */
export function loadOrganization(
  organizationId: string,
): OrganizationAction<LoadedOrganization | null> {
  return async () => {
    const response = await adminApi.getOrganization({ organizationId });
    const info = response.organization?.organization;
    return info ? { id: info.id, name: info.name, slug: info.slug } : null;
  };
}

/**
 * Saves the changed fields and brings the rest of the tab along: the organization list feeds the
 * user menu and header, and a refresh puts the new slug into this tab's credentials.
 */
export function saveOrganizationChanges(
  organizationId: string,
  changes: Partial<OrganizationFields>,
): OrganizationAction<OrganizationFields | null> {
  return async (dispatch) => {
    const response = await adminApi.updateOrganization({ organizationId, ...changes });
    if (changes.slug !== undefined) {
      // The refresh asks by organization id, so the rename cannot lose the grant. A failed refresh
      // only delays the new slug until the interceptor's next one; the save itself stands.
      await refreshAccessToken().catch((error: unknown) => {
        console.warn("[admin] refresh after slug change failed", error);
      });
    }
    void dispatch(fetchMyOrganizations());
    const organization = response.organization;
    return organization ? { name: organization.name, slug: organization.slug } : null;
  };
}

/**
 * Hands the organization to another member. The previous owner's role changes, so a refresh puts it
 * into this tab's credentials and the organization list reloads for the user menu.
 */
export function transferOrganizationOwnership(
  organizationId: string,
  newOwnerUserId: string,
): OrganizationAction<void> {
  return async (dispatch) => {
    await adminApi.transferOwnership({ organizationId, newOwnerUserId });
    await refreshAccessToken().catch((error: unknown) => {
      console.warn("[admin] refresh after ownership transfer failed", error);
    });
    void dispatch(fetchMyOrganizations());
  };
}

/** Deletes the organization and moves this tab out of it. */
export function deleteOrganization(request: {
  organizationId: string;
  confirmSlug: string;
  navigate: NavigateFunction;
}): OrganizationAction<void> {
  return async (_dispatch, getState) => {
    const { organizationId, confirmSlug, navigate } = request;
    const userId = getState().auth.user?.id;
    if (!userId) throw new ConnectError("Not signed in", Code.Unauthenticated);
    // The server revokes every grant before it answers, so a refresh another path starts in that
    // window must already read the loss as expected.
    const releaseExpectedLoss = expectOrganizationLoss(organizationId);
    try {
      await adminApi.deleteOrganization({ organizationId, confirmSlug });
    } catch (error) {
      releaseExpectedLoss();
      throw error;
    }
    // That refresh may have ended this scope already, and the cleanup still has to run.
    const dispatch = getStoreRefOrThrow().dispatch as AppDispatch;
    await leaveCurrentOrganizationScope(dispatch, {
      organizationId,
      userId,
      navigate,
      releaseExpectedLoss,
    });
  };
}
