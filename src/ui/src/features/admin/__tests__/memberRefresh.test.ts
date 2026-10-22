import { beforeEach, describe, expect, it, vi } from "vitest";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type { AppDispatch } from "@/app/store";
import { adminReducer } from "@/features/admin/store/adminSlice";
import { fetchMembers, refreshMembersQuietly } from "@/features/admin/store/adminThunks";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";

const shared = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/features/admin/api/adminApi", () => ({ adminApi: { listMembers: shared.list } }));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));

function memberPage(...userIds: string[]) {
  return {
    members: userIds.map((userId) => ({
      userId,
      displayName: userId,
      email: `${userId}@acme.test`,
      avatarUrl: "",
      hasAvatar: false,
      role: OrganizationRole.MEMBER,
      isActive: true,
    })),
    pagination: { totalCount: userIds.length },
  };
}

function createStore() {
  const store = configureStore({
    reducer: combineReducers({ auth: authReducer, admin: adminReducer }),
  });
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "refresh",
      organizationId: "org-acme",
    }),
  );
  return store;
}

let store = createStore();

function dispatch() {
  return store.dispatch as AppDispatch;
}

function memberIds() {
  return store.getState().admin.members.map((member) => member.userId);
}

beforeEach(() => {
  shared.list.mockReset();
  store = createStore();
});

describe("refreshMembersQuietly", () => {
  it("replaces the rows in place without raising the loading flag", async () => {
    shared.list.mockResolvedValueOnce(memberPage("alice"));
    await dispatch()(fetchMembers({}));
    shared.list.mockResolvedValueOnce(memberPage("alice", "bob"));

    const reload = dispatch()(refreshMembersQuietly({ search: "a" }));
    expect(store.getState().admin.membersLoading).toBe(false);
    await reload;

    expect(memberIds()).toEqual(["alice", "bob"]);
    expect(store.getState().admin.membersTotalCount).toBe(2);
    expect(shared.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-acme", search: "a" }),
    );
  });

  it("keeps the rows and settles without an error when the reload fails", async () => {
    shared.list.mockResolvedValueOnce(memberPage("alice"));
    await dispatch()(fetchMembers({}));
    shared.list.mockRejectedValueOnce(new Error("network unavailable"));

    const result = await dispatch()(refreshMembersQuietly({}));

    expect(refreshMembersQuietly.fulfilled.match(result)).toBe(true);
    expect(memberIds()).toEqual(["alice"]);
    expect(store.getState().admin.error).toBeNull();
  });

  it("drops a reload that an explicit load started after it overtook", async () => {
    let replyQuiet!: (page: ReturnType<typeof memberPage>) => void;
    shared.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          replyQuiet = resolve;
        }),
    );
    shared.list.mockResolvedValueOnce(memberPage("carol"));

    const reload = dispatch()(refreshMembersQuietly({}));
    await dispatch()(fetchMembers({ search: "carol" }));
    replyQuiet(memberPage("alice", "bob"));
    await reload;

    expect(memberIds()).toEqual(["carol"]);
  });
});
