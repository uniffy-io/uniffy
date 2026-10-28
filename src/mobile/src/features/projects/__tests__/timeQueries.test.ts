import { create } from "@bufbuild/protobuf";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ListReviewTimesheetsResponseSchema,
  ListTaskWorklogsResponseSchema,
} from "@uniffy/proto/projects/v1/time_pb";
import { reviewInboxOptions, taskWorklogOptions } from "@features/projects/timeQueries";

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

describe("time pagination", () => {
  it("loads task history on demand and carries the server token", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        create(ListTaskWorklogsResponseSchema, {
          worklogs: [{ id: "recent", workDate: "2026-10-20" }],
          nextPageToken: "older",
        }),
      )
      .mockResolvedValueOnce(
        create(ListTaskWorklogsResponseSchema, {
          worklogs: [{ id: "old", workDate: "2026-10-01" }],
        }),
      );
    const cache = client();
    const observer = new InfiniteQueryObserver(cache, taskWorklogOptions("org", "task", fetchPage));
    const first = await observer.refetch();
    expect(first.data?.map((row) => row.id)).toEqual(["recent"]);
    expect(observer.getCurrentResult().hasNextPage).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    const next = await observer.fetchNextPage();
    expect(fetchPage.mock.calls[1][0]).toMatchObject({ pageToken: "older", pageSize: 50 });
    expect(fetchPage.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    expect(next.data?.map((row) => row.id)).toEqual(["recent", "old"]);
    expect(next.hasNextPage).toBe(false);
    cache.clear();
  });

  it("loads remaining reviewers and clears old rows when the period changes", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        create(ListReviewTimesheetsResponseSchema, {
          rows: [{ userId: "first" }],
          nextPageToken: "next-reviewer",
        }),
      )
      .mockResolvedValueOnce(
        create(ListReviewTimesheetsResponseSchema, {
          rows: [{ userId: "second" }],
        }),
      );
    const cache = client();
    const observer = new InfiniteQueryObserver(
      cache,
      reviewInboxOptions("org", "2026-10-19", {}, fetchPage),
    );
    await observer.refetch();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    const next = await observer.fetchNextPage();
    expect(next.data?.rows.map((row) => row.userId)).toEqual(["first", "second"]);
    expect(next.hasNextPage).toBe(false);
    expect(fetchPage.mock.calls[1][0].pageToken).toBe("next-reviewer");
    observer.setOptions(reviewInboxOptions("org", "2026-10-26", {}, fetchPage));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    cache.clear();
  });

  it("keeps loaded entries after a later page fails and permits retry", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        create(ListTaskWorklogsResponseSchema, {
          worklogs: [{ id: "first" }],
          nextPageToken: "next",
        }),
      )
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(
        create(ListTaskWorklogsResponseSchema, { worklogs: [{ id: "last" }] }),
      );
    const cache = client();
    const observer = new InfiniteQueryObserver(cache, taskWorklogOptions("org", "task", fetchPage));
    await observer.refetch();
    const failed = await observer.fetchNextPage();
    expect(failed.data?.map((row) => row.id)).toEqual(["first"]);
    expect(failed.hasNextPage).toBe(true);
    const retried = await observer.fetchNextPage();
    expect(retried.data?.map((row) => row.id)).toEqual(["first", "last"]);
    cache.clear();
  });
});
