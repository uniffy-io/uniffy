import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { bookmarksApi } from "@/features/bookmarks/api/bookmarksApi";
import {
  addBookmarksSafely,
  bookmarksReducer,
  bulkCheckBookmarks,
  clearBookmarks,
  toggleBookmarkSafely,
} from "@/features/bookmarks/store/bookmarksSlice";
import {
  BOOKMARK_CHECK_BATCH_SIZE,
  bookmarkCheckBatches,
  bookmarkUrnsNeedingCheck,
} from "@/features/bookmarks/utils/bookmarkChecks";

vi.mock("@/features/bookmarks/api/bookmarksApi", () => ({
  bookmarksApi: {
    bulkCheckBookmarks: vi.fn(),
    toggleBookmark: vi.fn(),
  },
}));

function bookmarkStore() {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      bookmarks: bookmarksReducer,
    },
  });
  store.dispatch(credentials("organization-1"));
  return store;
}

function credentials(organizationId: string) {
  return setCredentials({
    user: { id: "user-1" } as never,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    organizationId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bookmark checks", () => {
  it("deduplicates visible URNs into server-sized batches", () => {
    const urns = Array.from(
      { length: BOOKMARK_CHECK_BATCH_SIZE * 2 + 5 },
      (_, index) => `urn:uniffy:content:NOTE:${index}`,
    );
    urns.push(urns[0]);

    const batches = bookmarkCheckBatches(urns);

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(new Set(batches.flat()).size).toBe(205);
  });

  it("hydrates only bookmark states that Redux does not already know", () => {
    const known = "urn:uniffy:content:CHAT_MESSAGE:known";
    const pending = "urn:uniffy:content:CHAT_MESSAGE:pending";
    const unknown = "urn:uniffy:content:CHAT_MESSAGE:unknown";

    expect(
      bookmarkUrnsNeedingCheck(
        [unknown, known, pending, unknown],
        { [known]: true },
        { [pending]: true },
      ),
    ).toEqual([unknown]);
  });

  it("reconciles an unknown saved item without toggling it off", async () => {
    const urn = "urn:uniffy:content:NOTE:older-visible";
    vi.mocked(bookmarksApi.bulkCheckBookmarks).mockResolvedValue({
      bookmarkedUrns: { [urn]: true },
    } as never);
    const store = bookmarkStore();

    const dispatchSafeToggle = store.dispatch as unknown as (
      action: ReturnType<typeof toggleBookmarkSafely>,
    ) => Promise<void>;
    await dispatchSafeToggle(toggleBookmarkSafely(urn));

    expect(bookmarksApi.bulkCheckBookmarks).toHaveBeenCalledWith({
      organizationId: "organization-1",
      urns: [urn],
    });
    expect(bookmarksApi.toggleBookmark).not.toHaveBeenCalled();
    expect(store.getState().bookmarks.bookmarkedUrns[urn]).toBe(true);
    expect(store.getState().bookmarks.checkedUrns[urn]).toBe(true);
  });

  it("retries a failed Chat check before allowing a destructive toggle", async () => {
    const urn = "urn:uniffy:content:CHAT_MESSAGE:older-saved-message";
    vi.mocked(bookmarksApi.bulkCheckBookmarks)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ bookmarkedUrns: { [urn]: true } } as never);
    const store = bookmarkStore();
    const dispatchBulkCheck = store.dispatch as unknown as (
      action: ReturnType<typeof bulkCheckBookmarks>,
    ) => Promise<unknown>;
    const dispatchSafeToggle = store.dispatch as unknown as (
      action: ReturnType<typeof toggleBookmarkSafely>,
    ) => Promise<void>;

    await dispatchBulkCheck(bulkCheckBookmarks([urn]));
    expect(store.getState().bookmarks.checkedUrns[urn]).toBeUndefined();
    expect(store.getState().bookmarks.checkingUrns[urn]).toBe(false);

    await dispatchSafeToggle(toggleBookmarkSafely(urn));

    expect(bookmarksApi.bulkCheckBookmarks).toHaveBeenCalledTimes(2);
    expect(bookmarksApi.toggleBookmark).not.toHaveBeenCalled();
    expect(store.getState().bookmarks.bookmarkedUrns[urn]).toBe(true);
    expect(store.getState().bookmarks.checkedUrns[urn]).toBe(true);
  });

  it("does not continue a preflight toggle after the organization changes", async () => {
    const urn = "urn:uniffy:content:NOTE:visible";
    let resolveCheck: ((value: { bookmarkedUrns: Record<string, boolean> }) => void) | undefined;
    vi.mocked(bookmarksApi.bulkCheckBookmarks).mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }) as never,
    );
    const store = bookmarkStore();
    const dispatchSafeToggle = store.dispatch as unknown as (
      action: ReturnType<typeof toggleBookmarkSafely>,
    ) => Promise<void>;

    const pendingToggle = dispatchSafeToggle(toggleBookmarkSafely(urn));
    await vi.waitFor(() => expect(bookmarksApi.bulkCheckBookmarks).toHaveBeenCalledOnce());
    store.dispatch(clearBookmarks());
    store.dispatch(credentials("organization-2"));
    resolveCheck?.({ bookmarkedUrns: { [urn]: false } });
    await pendingToggle;

    expect(bookmarksApi.toggleBookmark).not.toHaveBeenCalled();
    expect(store.getState().bookmarks.bookmarkedUrns[urn]).toBeUndefined();
  });

  it("stops a multi-item bookmark action when the organization changes", async () => {
    const urns = ["urn:uniffy:content:FILE:first", "urn:uniffy:content:FILE:second"];
    vi.mocked(bookmarksApi.bulkCheckBookmarks).mockResolvedValue({
      bookmarkedUrns: { [urns[0]]: false, [urns[1]]: false },
    } as never);
    let resolveToggle: ((value: { isBookmarked: boolean }) => void) | undefined;
    vi.mocked(bookmarksApi.toggleBookmark).mockReturnValue(
      new Promise((resolve) => {
        resolveToggle = resolve;
      }) as never,
    );
    const store = bookmarkStore();
    const dispatchAddBookmarks = store.dispatch as unknown as (
      action: ReturnType<typeof addBookmarksSafely>,
    ) => Promise<void>;

    const pendingAction = dispatchAddBookmarks(addBookmarksSafely(urns));
    await vi.waitFor(() => expect(bookmarksApi.toggleBookmark).toHaveBeenCalledOnce());
    store.dispatch(clearBookmarks());
    store.dispatch(credentials("organization-2"));
    resolveToggle?.({ isBookmarked: true });
    await pendingAction;

    expect(bookmarksApi.toggleBookmark).toHaveBeenCalledWith({
      organizationId: "organization-1",
      urn: urns[0],
    });
    expect(bookmarksApi.toggleBookmark).toHaveBeenCalledTimes(1);
  });
});
