import { createAsyncThunk, type ThunkAction, type UnknownAction } from "@reduxjs/toolkit";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { getStoreRefOrThrow } from "@/app/storeRef";
import { publicUnaryTransport, refreshAccessToken, setMemoryAccessToken } from "@/config/api";
import { organizationsApi } from "@/features/auth/api/organizationsApi";
import { withAuthLock } from "@/features/auth/authLock";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { authSlice, setCredentials } from "@/features/auth/store/authSlice";
import { readStoredAuth, writeStoredAuth } from "@/features/auth/store/credentialStorage";
import {
  clearLastOrganizationSlug,
  readLastOrganizationSlug,
  writeLastOrganization,
} from "@/features/auth/store/lastOrganizationStorage";
import {
  organizationAdded,
  organizationsFailed,
  organizationsLoaded,
  organizationsLoading,
  summarizeOrganization,
  switchFinished,
  switchStarted,
  type OrganizationSummary,
} from "@/features/auth/store/organizationsSlice";
import { listedRoleDiffers } from "@/features/auth/utils/organizationRoles";
import { parseUrn } from "@/shared/utils/urn";

export const LOST_ORGANIZATION_ACCESS_MESSAGE = "You no longer have access to that organization";
const SESSION_CHANGED_MESSAGE = "Session changed";

export interface OrganizationSwitch {
  organizationId: string;
}

export interface CreatedOrganization {
  organizationId: string;
  slug: string;
  name: string;
}

export type ContentOrganization = Pick<OrganizationSummary, "id" | "name" | "slug" | "role">;

export interface ContentOrganizationMatch {
  organization: ContentOrganization;
}

const thunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}>();

export const fetchMyOrganizations = thunk<OrganizationSummary[], void>(
  "organizations/fetchMyOrganizations",
  async (_, { dispatch, rejectWithValue }) => {
    dispatch(organizationsLoading());
    try {
      const response = await organizationsApi.listMyOrganizations();
      const items = response.organizations.map(summarizeOrganization);
      dispatch(organizationsLoaded(items, response.canCreateOrganization));
      return items;
    } catch (error) {
      dispatch(organizationsFailed());
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to load organizations",
      );
    }
  },
);

/**
 * Reloads the membership list, then refreshes this tab's credentials once when the list names another
 * role for its organization, so role-gated surfaces follow a change made in another session.
 */
export function reloadOrganizationsAndRole(): ThunkAction<
  Promise<void>,
  RootState,
  undefined,
  UnknownAction
> {
  return async (dispatch, getState) => {
    const result = await dispatch(fetchMyOrganizations());
    if (!fetchMyOrganizations.fulfilled.match(result)) return;
    const { currentOrganizationId, currentOrganizationRole } = getState().auth;
    if (!listedRoleDiffers(result.payload, currentOrganizationId, currentOrganizationRole)) return;
    // A failed refresh leaves the tab on its current token; the next expiry refresh catches up.
    await refreshAccessToken().catch(() => null);
  };
}

// The server reads only `urn:uniffy:content:{TYPE}:{id}`, while `buildUrn` writes the short form.
function toContentUrn(urn: string): string {
  const parsed = parseUrn(urn);
  return parsed.isValid ? `urn:uniffy:content:${parsed.type.toUpperCase()}:${parsed.id}` : urn;
}

/** Resolves to null on NOT_FOUND, which covers unknown, unviewable and foreign content alike. */
export const resolveContentOrganization = thunk<ContentOrganizationMatch | null, string>(
  "organizations/resolveContentOrganization",
  async (urn, { rejectWithValue }) => {
    try {
      const response = await organizationsApi.resolveContentOrganization({
        urn: toContentUrn(urn),
      });
      const organization = response.organization;
      if (!organization?.id) return null;
      return {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: response.role,
        },
      };
    } catch (error) {
      // A miss is an answer rather than a failure, so it fulfills and raises no toast.
      if (error instanceof ConnectError && error.code === Code.NotFound) return null;
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to resolve content organization",
      );
    }
  },
);

const runOrganizationSwitch = thunk<OrganizationSwitch, string>(
  "organizations/switchOrganization",
  async (slug, { dispatch, getState, rejectWithValue }) => {
    dispatch(switchStarted(slug));
    try {
      return await withAuthLock(async () => {
        const { user, currentSessionId } = getState().auth;
        const current = readStoredAuth();
        if (
          !user ||
          !current?.refreshToken ||
          current.user?.id !== user.id ||
          current.currentSessionId !== currentSessionId
        )
          return rejectWithValue(SESSION_CHANGED_MESSAGE);

        // The id survives a slug rename since the list loaded; the slug serves when it is unlisted.
        const picked = getState().organizations.items.find(
          (organization) => organization.slug === slug,
        );
        const client = createClient(AuthService, publicUnaryTransport);
        const response = await client.refreshToken({
          refreshToken: current.refreshToken,
          organizationId: picked?.id,
          organizationSlug: slug,
        });
        const latest = readStoredAuth();
        if (!latest || latest.refreshToken !== current.refreshToken)
          return rejectWithValue(SESSION_CHANGED_MESSAGE);

        if (!response.organizationId) {
          // The grant is gone but the refresh token still rotated. Only the token is kept, so the
          // tab stays in its organization on the access token it already holds.
          writeStoredAuth({ ...latest, refreshToken: response.refreshToken });
          dispatch(authSlice.actions.syncRefreshToken(response.refreshToken));
          if (readLastOrganizationSlug(user.id) === slug) clearLastOrganizationSlug(user.id);
          void dispatch(fetchMyOrganizations());
          return rejectWithValue(LOST_ORGANIZATION_ACCESS_MESSAGE);
        }

        const organizationSlug = response.organizationSlug || slug;
        void clearSessionCaches(dispatch, { reason: "switch" });
        dispatch(resetOrganizationScope());
        setMemoryAccessToken(response.accessToken);
        dispatch(
          setCredentials({
            user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            organizationId: response.organizationId,
            organizationSlug,
            organizationRole: response.organizationRole,
            sessionId: response.sessionId,
            domainAdminDomains: Array.from(response.domainAdminDomains),
          }),
        );
        writeLastOrganization(user.id, { id: response.organizationId, slug: organizationSlug });
        // The scope reset aborts a list load still in flight, which would otherwise stay loading.
        if (getState().organizations.status === "loading") void dispatch(fetchMyOrganizations());
        return { organizationId: response.organizationId };
      });
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to switch organization",
      );
    } finally {
      dispatch(switchFinished());
    }
  },
);

/**
 * Runs on the store itself because the session scope guard aborts in-flight thunks and drops their
 * dispatches when an organization scope ends, and the switch is what ends it. Resolves with the new
 * organization or rejects with the message the rejected action already toasted.
 */
export function switchOrganization(
  slug: string,
): ThunkAction<Promise<OrganizationSwitch>, RootState, unknown, UnknownAction> {
  return (_dispatch, getState) =>
    runOrganizationSwitch(slug)(
      getStoreRefOrThrow().dispatch as AppDispatch,
      getState,
      undefined,
    ).unwrap();
}

/**
 * Creates the organization and switches this tab into it. A refused create rejects with its
 * ConnectError and no toast, so the form can place the message; a failed switch afterwards rejects
 * with the message the switch already toasted.
 */
export function createOrganization(request: {
  name: string;
  slug?: string;
}): ThunkAction<Promise<CreatedOrganization>, RootState, unknown, UnknownAction> {
  return async (dispatch) => {
    const response = await organizationsApi.createOrganization({
      name: request.name,
      slug: request.slug || undefined,
    });
    const created = response.organization ? summarizeOrganization(response.organization) : null;
    if (!created?.id || !created.slug) {
      throw new ConnectError("The created organization was not returned", Code.Internal);
    }
    // The switch ends this scope and drops later dispatches, so the list learns of it first.
    dispatch(organizationAdded(created));
    const { organizationId } = await dispatch(switchOrganization(created.slug));
    return { organizationId, slug: created.slug, name: created.name };
  };
}
