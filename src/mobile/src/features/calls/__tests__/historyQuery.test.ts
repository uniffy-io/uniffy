import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { GetCallRecordResponseSchema } from "@uniffy/proto/calls/v1/calls_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callsApi } from "@features/calls/callsApi";
import { callHistoryOptions } from "@features/calls/historyQuery";

vi.mock("@features/calls/callsApi", () => ({
  callsApi: { getCallRecord: vi.fn(), listCallHistory: vi.fn() },
}));

const client = new QueryClient();
const options = callHistoryOptions(client, "org", undefined, "call");
const response = create(GetCallRecordResponseSchema, {
  record: { title: "Private call", call: { id: "call", channelId: "private" } },
  participants: [{ userId: "person", displayName: "Attendee" }],
});

afterEach(() => {
  client.clear();
  vi.resetAllMocks();
});

describe("call history authorization", () => {
  it.each([Code.PermissionDenied, Code.NotFound, Code.Unauthenticated])(
    "discards cached details on refusal %s and recovers after access returns",
    async (code) => {
      vi.mocked(callsApi.getCallRecord).mockResolvedValue(response);
      await client.fetchInfiniteQuery(options);
      const error = new ConnectError("Denied", code);
      vi.mocked(callsApi.getCallRecord).mockRejectedValue(error);
      await expect(client.fetchInfiniteQuery(options)).rejects.toBe(error);
      expect(client.getQueryData(options.queryKey)).toEqual({ pages: [], pageParams: [] });
      expect(client.getQueryState(options.queryKey)?.status).toBe("error");
      expect(callsApi.getCallRecord).toHaveBeenCalledTimes(2);
      vi.mocked(callsApi.getCallRecord).mockResolvedValue(response);
      const restored = await client.fetchInfiniteQuery(options);
      expect(restored.pages[0].records[0].title).toBe("Private call");
    },
  );

  it("retains cached history for transient network failures", async () => {
    vi.mocked(callsApi.getCallRecord).mockResolvedValue(response);
    const cached = await client.fetchInfiniteQuery(options);
    const error = new ConnectError("Offline", Code.Unavailable);
    vi.mocked(callsApi.getCallRecord).mockRejectedValue(error);
    await expect(client.fetchInfiniteQuery({ ...options, retry: false })).rejects.toBe(error);
    expect(client.getQueryData(options.queryKey)).toEqual(cached);
  });

  it("ignores a canceled refusal after a newer authorized response", async () => {
    let refuse!: (reason: unknown) => void;
    vi.mocked(callsApi.getCallRecord).mockReturnValueOnce(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    const canceled = client.fetchInfiniteQuery(options).catch(() => undefined);
    await client.cancelQueries({ queryKey: options.queryKey });
    vi.mocked(callsApi.getCallRecord).mockResolvedValue(response);
    const current = await client.fetchInfiniteQuery(options);
    refuse(new ConnectError("Denied", Code.PermissionDenied));
    await canceled;
    await Promise.resolve();
    expect(client.getQueryData(options.queryKey)).toEqual(current);
  });
});
