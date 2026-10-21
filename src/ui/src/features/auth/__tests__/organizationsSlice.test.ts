import { describe, expect, it } from "vitest";
import { combineReducers } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { OrganizationInfoSchema, OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { MyOrganizationSchema } from "@uniffy/proto/organizations/v1/organizations_pb";
import {
  authReducer,
  logout,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";
import {
  organizationsFailed,
  organizationsLoaded,
  organizationsLoading,
  organizationsReducer,
  selectCurrentOrganization,
  selectOrganizations,
  selectOrganizationsStatus,
  summarizeOrganization,
  switchFinished,
  switchStarted,
  type OrganizationSummary,
} from "@/features/auth/store/organizationsSlice";

const reducer = combineReducers({ auth: authReducer, organizations: organizationsReducer });
type State = ReturnType<typeof reducer>;

function summary(id: string, slug: string, overrides: Partial<OrganizationSummary> = {}) {
  return {
    id,
    name: slug.toUpperCase(),
    slug,
    role: OrganizationRole.MEMBER,
    suspended: false,
    joinedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } satisfies OrganizationSummary;
}

function signedIn(organizationId?: string): State {
  let state = reducer(undefined, { type: "@@init" });
  state = reducer(
    state,
    setCredentials({
      user: { id: "user-a" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "refresh",
      organizationId,
    }),
  );
  return reducer(
    state,
    organizationsLoaded([summary("org-a", "acme"), summary("org-b", "globex")]),
  );
}

describe("summarizeOrganization", () => {
  it("maps the membership into a plain summary", () => {
    const joined = new Date("2026-09-14T08:30:00.000Z");
    const proto = create(MyOrganizationSchema, {
      organization: create(OrganizationInfoSchema, { id: "org-a", name: "Acme", slug: "acme" }),
      role: OrganizationRole.OWNER,
      joinedAt: timestampFromDate(joined),
      suspended: true,
    });

    expect(summarizeOrganization(proto)).toEqual({
      id: "org-a",
      name: "Acme",
      slug: "acme",
      role: OrganizationRole.OWNER,
      suspended: true,
      joinedAt: "2026-09-14T08:30:00.000Z",
    });
  });

  it("reads an active membership as not suspended", () => {
    const proto = create(MyOrganizationSchema, {
      organization: create(OrganizationInfoSchema, { id: "org-b", name: "Globex", slug: "globex" }),
      role: OrganizationRole.ADMIN,
    });

    const result = summarizeOrganization(proto);

    expect(result.suspended).toBe(false);
    expect(result.role).toBe(OrganizationRole.ADMIN);
    expect(result.joinedAt).toBe("");
    expect(result).not.toHaveProperty("$typeName");
  });
});

describe("organizationsSlice", () => {
  it("tracks the load lifecycle and keeps the last list on failure", () => {
    let state = reducer(undefined, { type: "@@init" });
    expect(selectOrganizationsStatus(state)).toBe("idle");

    state = reducer(state, organizationsLoading());
    expect(selectOrganizationsStatus(state)).toBe("loading");

    state = reducer(state, organizationsLoaded([summary("org-a", "acme")]));
    expect(selectOrganizationsStatus(state)).toBe("ready");
    expect(selectOrganizations(state).map((item) => item.slug)).toEqual(["acme"]);

    state = reducer(state, organizationsFailed());
    expect(selectOrganizationsStatus(state)).toBe("error");
    expect(selectOrganizations(state)).toHaveLength(1);
  });

  it("records the slug being switched to until the switch settles", () => {
    let state = reducer(undefined, switchStarted("globex"));
    expect(state.organizations.switchingSlug).toBe("globex");

    state = reducer(state, switchFinished());
    expect(state.organizations.switchingSlug).toBeNull();
  });

  it("selects the organization the tab is signed into", () => {
    expect(selectCurrentOrganization(signedIn("org-b"))?.slug).toBe("globex");
  });

  it("selects nothing without a current organization or when it is not listed", () => {
    expect(selectCurrentOrganization(signedIn())).toBeNull();
    expect(selectCurrentOrganization(signedIn("org-gone"))).toBeNull();
  });

  it("resets on logout", () => {
    const before = reducer(signedIn("org-a"), switchStarted("globex"));
    const after = reducer(before, logout());

    expect(after.organizations).toEqual({ items: [], status: "idle", switchingSlug: null });
  });

  it("resets when rehydration fails", () => {
    const after = reducer(signedIn("org-a"), rehydrateFailed());

    expect(after.organizations).toEqual({ items: [], status: "idle", switchingSlug: null });
  });
});
