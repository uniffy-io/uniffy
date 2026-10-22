import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { MyOrganization } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type { RootState } from "@/app/store";
import { AUTH_ACTION_TYPES, resetOrganizationScope } from "@/features/auth/store/authActions";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  suspended: boolean;
  joinedAt: string;
}

export type OrganizationsStatus = "idle" | "loading" | "ready" | "error";

export interface OrganizationsState {
  items: OrganizationSummary[];
  status: OrganizationsStatus;
  /** How the last settled load ended; a reload keeps it, so pages keep what they show. */
  settled: "ready" | "error" | null;
  switchingSlug: string | null;
  /** The deployment's creation policy as the server applied it to this user at the last load. */
  canCreateOrganization: boolean;
}

const initialState: OrganizationsState = {
  items: [],
  status: "idle",
  settled: null,
  switchingSlug: null,
  canCreateOrganization: false,
};

export function summarizeOrganization(proto: MyOrganization): OrganizationSummary {
  return {
    id: proto.organization?.id ?? "",
    name: proto.organization?.name ?? "",
    slug: proto.organization?.slug ?? "",
    role: proto.role,
    suspended: proto.suspended,
    joinedAt: proto.joinedAt ? timestampDate(proto.joinedAt).toISOString() : "",
  };
}

export const organizationsSlice = createSlice({
  name: "organizations",
  initialState,
  reducers: {
    organizationsLoading: (state) => {
      state.status = "loading";
    },
    organizationsLoaded: {
      reducer: (
        state,
        action: PayloadAction<{ items: OrganizationSummary[]; canCreateOrganization: boolean }>,
      ) => {
        state.items = action.payload.items;
        state.canCreateOrganization = action.payload.canCreateOrganization;
        state.status = "ready";
        state.settled = "ready";
      },
      prepare: (items: OrganizationSummary[], canCreateOrganization = false) => ({
        payload: { items, canCreateOrganization },
      }),
    },
    // Placed by name, the order the server lists memberships in, so a reload does not reorder it.
    organizationAdded: (state, action: PayloadAction<OrganizationSummary>) => {
      const items = state.items.filter((item) => item.id !== action.payload.id);
      const before = items.findIndex((item) => item.name.localeCompare(action.payload.name) > 0);
      items.splice(before === -1 ? items.length : before, 0, action.payload);
      state.items = items;
    },
    // A failed reload keeps the last good list so the switcher stays usable.
    organizationsFailed: (state) => {
      state.status = "error";
      state.settled = "error";
    },
    // A background reload that failed puts back the status it found, so it shows no error.
    organizationsReloadFailed: (state, action: PayloadAction<OrganizationsStatus>) => {
      state.status = action.payload;
    },
    switchStarted: (state, action: PayloadAction<string>) => {
      state.switchingSlug = action.payload;
    },
    switchFinished: (state) => {
      state.switchingSlug = null;
    },
  },
  extraReducers: (builder) => {
    // The list is the signed-in user's memberships; the next account starts from nothing.
    builder.addCase(AUTH_ACTION_TYPES.LOGOUT, () => initialState);
    builder.addCase(AUTH_ACTION_TYPES.REHYDRATE_FAILED, () => initialState);
    // A switch keeps the list but aborts a load in flight and drops its later dispatches, so the
    // load it interrupted would otherwise never settle.
    builder.addCase(resetOrganizationScope, (state) => {
      if (state.status === "loading") state.status = "idle";
    });
  },
});

export const {
  organizationsLoading,
  organizationsLoaded,
  organizationAdded,
  organizationsFailed,
  organizationsReloadFailed,
  switchStarted,
  switchFinished,
} = organizationsSlice.actions;
export const organizationsReducer = organizationsSlice.reducer;

type OrganizationsRootState = Pick<RootState, "auth" | "organizations">;

export const selectOrganizations = (state: OrganizationsRootState) => state.organizations.items;
export const selectOrganizationsStatus = (state: OrganizationsRootState) =>
  state.organizations.status;
export const selectOrganizationsSettled = (state: OrganizationsRootState) =>
  state.organizations.settled;
export const selectCanCreateOrganization = (state: OrganizationsRootState) =>
  state.organizations.canCreateOrganization;

/**
 * Whether `slug` names the tab's organization. The listed id decides, since the slug may have been
 * renamed since the list or the credentials loaded; the slug serves only for an unlisted one.
 */
export function isCurrentOrganizationSlug(
  slug: string,
  organizations: OrganizationSummary[],
  current: { id: string | null; slug: string | null },
): boolean {
  const listed = organizations.find((organization) => organization.slug === slug);
  return listed ? listed.id === current.id : slug === current.slug;
}

export const selectCurrentOrganization = (
  state: OrganizationsRootState,
): OrganizationSummary | null => {
  const currentId = state.auth.currentOrganizationId;
  if (!currentId) return null;
  return state.organizations.items.find((item) => item.id === currentId) ?? null;
};
