import { beforeEach, describe, expect, it, vi } from "vitest";
import { combineReducers, configureStore, type Store } from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch, RootState } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { setStoreRef } from "@/app/storeRef";
import { setMemoryAccessToken } from "@/config/api";
import {
  changedOrganizationFields,
  organizationFieldError,
  saveOrganizationChanges,
} from "@/features/admin/components/organization/organizationChanges";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { organizationsReducer } from "@/features/auth/store/organizationsSlice";

const shared = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), list: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    updateOrganization: shared.update,
    refreshToken: shared.refresh,
    listMyOrganizations: shared.list,
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));
vi.mock("@/features/auth/hooks/useSignOut", () => ({ clearSessionCaches: vi.fn() }));

const saved = { name: "Acme", slug: "acme" };

function createStore() {
  return configureStore({
    reducer: combineReducers({ auth: authReducer, organizations: organizationsReducer }),
    middleware: (defaults) =>
      defaults().prepend(sessionScopeMiddleware).concat(credentialMiddleware),
  });
}

let store = createStore();

function dispatch() {
  return store.dispatch as AppDispatch;
}

beforeEach(() => {
  shared.update.mockReset();
  shared.refresh.mockReset();
  shared.list.mockReset().mockResolvedValue({ organizations: [], canCreateOrganization: false });
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
  }
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {
    locks: { request: (_key: string, work: () => Promise<unknown>) => work() },
  });
  store = createStore();
  setStoreRef(store as unknown as Store<RootState>);
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access-acme",
      refreshToken: "first",
      organizationId: "org-acme",
      organizationSlug: "acme",
      organizationRole: "OWNER",
      sessionId: "session",
    }),
  );
  setMemoryAccessToken("access-acme");
});

describe("changedOrganizationFields", () => {
  it("reports nothing while the draft matches the saved fields", () => {
    expect(changedOrganizationFields(saved, saved)).toEqual({});
    expect(changedOrganizationFields(saved, { name: "  Acme ", slug: "acme-" })).toEqual({});
  });

  it("holds only the fields that changed, trimmed and canonical", () => {
    expect(changedOrganizationFields(saved, { name: " Acme Labs ", slug: "acme" })).toEqual({
      name: "Acme Labs",
    });
    expect(changedOrganizationFields(saved, { name: "Acme", slug: "acme-labs-" })).toEqual({
      slug: "acme-labs",
    });
  });
});

describe("organizationFieldError", () => {
  it("places an INVALID_ARGUMENT that names the slug under the slug field", () => {
    const error = new ConnectError(
      "Validation error on 'slug': Slug is already in use",
      Code.InvalidArgument,
    );
    expect(organizationFieldError(error)).toEqual({
      field: "slug",
      message: "Slug is already in use",
    });
  });

  it("places a name refusal under the name field", () => {
    const error = new ConnectError(
      "Validation error on 'name': name is required",
      Code.InvalidArgument,
    );
    expect(organizationFieldError(error)).toEqual({ field: "name", message: "Name is required" });
  });

  it("leaves other refusals to the toast", () => {
    expect(
      organizationFieldError(new ConnectError("Slug is already in use", Code.PermissionDenied)),
    ).toBeNull();
    expect(
      organizationFieldError(new ConnectError("Invalid organization_id", Code.InvalidArgument)),
    ).toBeNull();
    expect(organizationFieldError(new Error("Validation error on 'slug': taken"))).toBeNull();
  });
});

describe("saveOrganizationChanges", () => {
  it("sends only the changed name and keeps the credentials as they are", async () => {
    shared.update.mockResolvedValue({
      organization: { id: "org-acme", name: "Acme Labs", slug: "acme" },
    });

    await expect(
      saveOrganizationChanges(dispatch(), "org-acme", { name: "Acme Labs" }),
    ).resolves.toEqual({ name: "Acme Labs", slug: "acme" });

    expect(shared.update).toHaveBeenCalledWith({ organizationId: "org-acme", name: "Acme Labs" });
    expect(shared.update.mock.calls[0][0]).not.toHaveProperty("slug");
    expect(shared.refresh).not.toHaveBeenCalled();
    expect(shared.list).toHaveBeenCalledOnce();
  });

  it("refreshes by organization id after a slug change so the tab carries the new slug", async () => {
    shared.update.mockResolvedValue({
      organization: { id: "org-acme", name: "Acme", slug: "acme-labs" },
    });
    shared.refresh.mockResolvedValue({
      accessToken: "access-acme-2",
      refreshToken: "second",
      organizationId: "org-acme",
      organizationSlug: "acme-labs",
      organizationRole: "OWNER",
      sessionId: "session",
      domainAdminDomains: [],
    });

    await saveOrganizationChanges(dispatch(), "org-acme", { slug: "acme-labs" });

    expect(shared.update).toHaveBeenCalledWith({ organizationId: "org-acme", slug: "acme-labs" });
    expect(shared.refresh).toHaveBeenCalledOnce();
    expect(shared.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "first", organizationId: "org-acme" }),
    );
    expect(store.getState().auth.currentOrganizationId).toBe("org-acme");
    expect(store.getState().auth.currentOrganizationSlug).toBe("acme-labs");
  });

  it("keeps a saved slug when the refresh after it fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    shared.update.mockResolvedValue({
      organization: { id: "org-acme", name: "Acme", slug: "acme-labs" },
    });
    shared.refresh.mockRejectedValue(new ConnectError("offline", Code.Unavailable));

    await expect(
      saveOrganizationChanges(dispatch(), "org-acme", { slug: "acme-labs" }),
    ).resolves.toEqual({ name: "Acme", slug: "acme-labs" });
  });

  it("rejects with the server refusal and refreshes nothing", async () => {
    const refusal = new ConnectError(
      "Validation error on 'slug': Slug is already in use",
      Code.InvalidArgument,
    );
    shared.update.mockRejectedValue(refusal);

    await expect(saveOrganizationChanges(dispatch(), "org-acme", { slug: "globex" })).rejects.toBe(
      refusal,
    );
    expect(shared.refresh).not.toHaveBeenCalled();
    expect(shared.list).not.toHaveBeenCalled();
  });
});
