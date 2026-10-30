import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { CallRecordSchema, CallInvitationOutcome } from "@uniffy/proto/calls/v1/calls_pb";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { historyRecordToPlain, callDuration } from "@features/calls/historySerializer";
import { nativeRouteFor } from "@shared/lib/contentTypes";
import { appPathForLink } from "@shared/lib/appLinks";

describe("call history", () => {
  it("keeps a missed invitation alongside later attendance", () => {
    const record = historyRecordToPlain(
      create(CallRecordSchema, {
        call: {
          id: "call",
          channelId: "channel",
          startedAt: { seconds: 60n },
          endedAt: { seconds: 190n },
        },
        attended: true,
        invitationOutcome: CallInvitationOutcome.MISSED,
      }),
    );
    expect(record.attended).toBe(true);
    expect(record.outcome).toBe("Missed");
    expect(callDuration(record)).toBe("2m 10s");
  });
  it("opens search, web and native links at the same record", () => {
    expect(nativeRouteFor(SearchResultType.CALL, "call")).toBe("/calls/call");
    expect(appPathForLink("https://example.com/calls/call", "https://example.com")).toBe(
      "/calls/call",
    );
    expect(appPathForLink("uniffy://calls/call", "https://example.com")).toBe("/calls/call");
    expect(appPathForLink("https://other.com/calls/call", "https://example.com")).toBeNull();
  });
});
