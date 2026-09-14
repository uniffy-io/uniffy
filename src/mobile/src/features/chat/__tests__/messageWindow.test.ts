import { describe, expect, it, vi } from "vitest";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { messageWindowOptions, type MessageWindowCursor } from "@features/chat/messageWindow";

const history = Array.from({ length: 150 }, (_, index) => ({ id: String(index + 1) }));

function page(cursor: MessageWindowCursor) {
  const target = Number(cursor.aroundId || cursor.beforeId || cursor.afterId);
  const selected = cursor.aroundId
    ? history.slice(Math.max(0, target - 26), target + 25)
    : cursor.afterId
      ? history.slice(target, target + 50)
      : history.slice(Math.max(0, target - 51), target - 1);
  return {
    messages: [...selected].reverse(),
    hasMore: cursor.afterId ? target + 50 < history.length : target > (cursor.aroundId ? 26 : 51),
  };
}

function setup(target: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = vi.fn(async (cursor: MessageWindowCursor) => page(cursor));
  const options = messageWindowOptions("org", "channel", "user:visit", target, fetch);
  const observer = new InfiniteQueryObserver(client, options);
  return { client, fetch, options, observer };
}

function ids(observer: ReturnType<typeof setup>["observer"]) {
  return observer
    .getCurrentResult()
    .data!.pages.flatMap((item) => item.messages.map((message) => Number(message.id)));
}

describe("mobile unread history window", () => {
  it("loads exact first unread beyond latest page and pages forward without a gap", async () => {
    const { client, fetch, observer } = setup("1");
    try {
      await observer.refetch();
      expect(fetch.mock.calls[0][0]).toEqual({ aroundId: "1" });
      expect(ids(observer)).toEqual(Array.from({ length: 26 }, (_, index) => 26 - index));
      expect(observer.getCurrentResult().hasNextPage).toBe(false);
      await observer.fetchPreviousPage();
      expect(fetch.mock.calls[1][0]).toEqual({ afterId: "26" });
      expect(ids(observer)).toEqual(Array.from({ length: 76 }, (_, index) => 76 - index));
      await observer.fetchPreviousPage();
      await observer.fetchPreviousPage();
      expect(ids(observer)).toEqual(Array.from({ length: 150 }, (_, index) => 150 - index));
      expect(observer.getCurrentResult().hasPreviousPage).toBe(false);
    } finally {
      observer.destroy();
      client.clear();
    }
  });

  it("pages both directions and retains contiguous history through event refetch", async () => {
    const { client, observer } = setup("75");
    try {
      await observer.refetch();
      await observer.fetchNextPage();
      await observer.fetchPreviousPage();
      expect(ids(observer)).toEqual(Array.from({ length: 150 }, (_, index) => 150 - index));
      await observer.refetch();
      expect(ids(observer)).toEqual(Array.from({ length: 150 }, (_, index) => 150 - index));
    } finally {
      observer.destroy();
      client.clear();
    }
  });

  it("keeps delayed responses separate from another user's channel visit", async () => {
    const { client, options, observer } = setup("1");
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = client.fetchInfiniteQuery({
      ...options,
      queryFn: async (context) => {
        await delayed;
        return options.queryFn(context);
      },
    });
    const next = messageWindowOptions(
      "org",
      "channel",
      "another-user:visit",
      "145",
      async (cursor) => page(cursor),
    );
    const current = await client.fetchInfiniteQuery(next);
    release();
    await old;
    expect(client.getQueryData(next.queryKey)).toBe(current);
    expect(current.pages[0].messages[0].id).toBe("150");
    observer.destroy();
    client.clear();
  });

  it("retains failed window state so retry can recover the same target", async () => {
    const { client, fetch, observer } = setup("1");
    try {
      fetch.mockRejectedValueOnce(new Error("offline"));
      await observer.refetch();
      expect(observer.getCurrentResult().isError).toBe(true);
      await observer.refetch();
      expect(ids(observer).at(-1)).toBe(1);
    } finally {
      observer.destroy();
      client.clear();
    }
  });
});
