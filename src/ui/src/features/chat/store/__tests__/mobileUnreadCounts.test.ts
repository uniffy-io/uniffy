import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { UnreadCountPayloadSchema } from "@uniffy/proto/chat/v1/chat_stream_pb";
import { applyUnreadCount } from "@/../../mobile/src/features/chat/unreadCounts";

describe("mobile unread events", () => {
  it("replaces absolute totals and preserves both cursor fields through deltas", () => {
    const initial = { channel: { unread: 2, mentions: 1, lastReadMessageId: "prior" } };
    const absolute = applyUnreadCount(
      initial,
      create(UnreadCountPayloadSchema, {
        channelId: "channel",
        absolute: true,
        unreadCount: 3,
        mentionCount: 2,
        lastReadMessageId: "",
        firstUnreadMessageId: "first",
      }),
    );
    const result = applyUnreadCount(
      absolute,
      create(UnreadCountPayloadSchema, {
        channelId: "channel",
        unreadCount: 1,
        mentionCount: 0,
      }),
    );
    expect(result.channel).toEqual({
      unread: 4,
      mentions: 2,
      lastReadMessageId: "",
      firstUnreadMessageId: "first",
    });
    expect(initial.channel.unread).toBe(2);
  });

  it("accepts absolute zero and explicit target clearing", () => {
    const result = applyUnreadCount(
      {
        channel: {
          unread: 3,
          mentions: 2,
          lastReadMessageId: "prior",
          firstUnreadMessageId: "first",
        },
      },
      create(UnreadCountPayloadSchema, {
        channelId: "channel",
        absolute: true,
        unreadCount: 0,
        mentionCount: 0,
        lastReadMessageId: "latest",
        firstUnreadMessageId: "",
      }),
    );
    expect(result.channel).toEqual({
      unread: 0,
      mentions: 0,
      lastReadMessageId: "latest",
      firstUnreadMessageId: "",
    });
  });

  it("initializes missing cache and leaves other channels unchanged", () => {
    const result = applyUnreadCount(
      undefined,
      create(UnreadCountPayloadSchema, {
        channelId: "channel",
        unreadCount: 1,
      }),
    );
    const updated = applyUnreadCount(
      result,
      create(UnreadCountPayloadSchema, {
        channelId: "other",
        unreadCount: 2,
      }),
    );
    expect(updated.channel).toBe(result.channel);
    expect(updated.other).toEqual({ unread: 2, mentions: 0 });
  });
});
