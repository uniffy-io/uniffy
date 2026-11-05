import { describe, expect, it } from "vitest";
import { localSend, mergeSendRows } from "@features/chat/sendState";

const pending = localSend(
  { channelId: "channel", content: "hello", clientMessageId: "id" },
  "user",
  false,
);
const confirmed = { ...pending, id: "server-id", metadata: {} };
describe("mobile retry reconciliation", () => {
  it("collapses lost acknowledgement retries into the stream-confirmed row", () => {
    expect(mergeSendRows([pending], [confirmed])).toEqual([confirmed]);
    expect(mergeSendRows([confirmed], [pending])).toEqual([confirmed]);
    expect(mergeSendRows([confirmed], [confirmed])).toEqual([confirmed]);
  });
  it("keeps failed sends across snapshot recovery and reconciles after retry", () => {
    const failed = localSend(
      { channelId: "channel", content: "hello", clientMessageId: "id" },
      "user",
      true,
    );
    expect(mergeSendRows([failed], [])).toEqual([failed]);
    expect(mergeSendRows([failed], [confirmed])).toEqual([confirmed]);
  });
  it("never matches another sender's client identifier", () => {
    const other = { ...confirmed, senderId: "other" };
    expect(mergeSendRows([pending], [other])).toHaveLength(2);
  });
  it("retains thread and attachment identity for failed UI rows", () => {
    const failed = localSend(
      {
        channelId: "channel",
        rootId: "root",
        replyToId: "reply",
        content: "file",
        attachmentFileIds: ["f1", "f2"],
        clientMessageId: "id",
      },
      "user",
      true,
    );
    expect(failed).toMatchObject({
      rootId: "root",
      replyToId: "reply",
      clientMessageId: "id",
      metadata: { failed: "1", attachmentIds: "f1,f2" },
    });
  });
});
