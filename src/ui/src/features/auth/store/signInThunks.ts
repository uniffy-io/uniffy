import { createAsyncThunk } from "@reduxjs/toolkit";
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { AppDispatch, RootState } from "@/app/store";
import {
  clearMemoryAccessToken,
  initStorageEncryptionFromApi,
  publicUnaryTransport,
  setMemoryAccessToken,
  unaryTransport,
} from "@/config/api";
import { setAccentColor, setFontFamily } from "@/config/theme/themeSlice";
import { organizationsApi } from "@/features/auth/api/organizationsApi";
import { setCredentials } from "@/features/auth/store/authSlice";
import {
  clearLastOrganizationSlug,
  readLastOrganizationSlug,
  writeLastOrganization,
} from "@/features/auth/store/lastOrganizationStorage";
import {
  organizationsLoaded,
  summarizeOrganization,
  type OrganizationSummary,
} from "@/features/auth/store/organizationsSlice";

/** The token set that login, MFA, enrollment, registration and invitations all return. */
export interface SignInResult {
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  organizationSlug?: string;
  organizationRole?: string;
  sessionId?: string;
  domainAdminDomains?: number[];
}

export interface SignInCompletion {
  organizationId: string | null;
}

const thunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}>();

async function fetchSignedInUser(accessToken: string) {
  const client = createClient(AuthService, unaryTransport);
  const response = await client.getCurrentUser(
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return {
    id: response.id,
    email: response.email,
    username: response.username,
    fullName: response.fullName,
    isActive: response.isActive,
    isSystemAdmin: response.isSystemAdmin,
    emailVerified: response.emailVerified,
    accentColor: response.accentColor,
    fontFamily: response.fontFamily,
    avatarUrl: response.avatarUrl,
    hasAvatar: response.hasAvatar,
    pronouns: response.pronouns,
  };
}

/** Mints the only organization or the remembered one; any other case leaves the choice to the picker. */
async function chooseOrganization(
  result: SignInResult,
  userId: string,
  dispatch: AppDispatch,
): Promise<SignInResult> {
  let organizations: OrganizationSummary[];
  try {
    const response = await organizationsApi.listMyOrganizations();
    organizations = response.organizations.map(summarizeOrganization);
  } catch {
    // The picker loads the list on its own, so a failed list only skips the automatic choice.
    return result;
  }
  dispatch(organizationsLoaded(organizations));

  const remembered = readLastOrganizationSlug(userId);
  if (remembered && !organizations.some((organization) => organization.slug === remembered)) {
    clearLastOrganizationSlug(userId);
  }
  const candidate =
    organizations.length === 1
      ? organizations[0]
      : organizations.find((organization) => organization.slug === remembered);
  if (!candidate || candidate.suspended) return result;

  const client = createClient(AuthService, publicUnaryTransport);
  const minted = await client.refreshToken({
    refreshToken: result.refreshToken,
    organizationId: candidate.id,
    organizationSlug: candidate.slug,
  });
  // The membership ended between the list and the mint; the rotated token still signs in org-less.
  if (!minted.organizationId) clearLastOrganizationSlug(userId);
  return {
    accessToken: minted.accessToken,
    refreshToken: minted.refreshToken,
    organizationId: minted.organizationId,
    organizationSlug: minted.organizationId ? minted.organizationSlug || candidate.slug : undefined,
    organizationRole: minted.organizationRole,
    sessionId: minted.sessionId || result.sessionId,
    domainAdminDomains: Array.from(minted.domainAdminDomains),
  };
}

/**
 * Picks the organization before the credentials land, so the picker only shows when the user has
 * to choose. Resolves with a null organization when the picker is next.
 */
export const completeSignIn = thunk<SignInCompletion, SignInResult>(
  "auth/completeSignIn",
  async (result, { dispatch, rejectWithValue }) => {
    try {
      setMemoryAccessToken(result.accessToken);
      const user = await fetchSignedInUser(result.accessToken);
      if (user.accentColor) dispatch(setAccentColor(user.accentColor));
      if (user.fontFamily) dispatch(setFontFamily(user.fontFamily));

      const credentials = result.organizationId
        ? result
        : await chooseOrganization(result, user.id, dispatch);
      setMemoryAccessToken(credentials.accessToken);
      dispatch(
        setCredentials({
          user,
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          organizationId: credentials.organizationId,
          organizationSlug: credentials.organizationSlug,
          organizationRole: credentials.organizationRole,
          sessionId: credentials.sessionId,
          domainAdminDomains: credentials.domainAdminDomains,
        }),
      );
      if (credentials.organizationId && credentials.organizationSlug) {
        writeLastOrganization(user.id, {
          id: credentials.organizationId,
          slug: credentials.organizationSlug,
        });
      }

      initStorageEncryptionFromApi(user.id).catch((error) => {
        console.warn("Storage encryption init failed:", error);
      });
      return { organizationId: credentials.organizationId || null };
    } catch (error) {
      clearMemoryAccessToken();
      return rejectWithValue(error instanceof Error ? error.message : "Sign in failed");
    }
  },
);
