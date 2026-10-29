import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { CallReaction } from "@uniffy/proto/calls/v1/calls_pb";
import {
  activeCallsKey,
  applyParticipantEvent,
  pushCallReaction,
  reactionsKey,
  upsertActiveCall,
  syncActiveCalls,
} from "@features/calls/useCallsState";
import type { PlainCall } from "@features/calls/callsSerializer";
vi.mock("@core/providers/AuthContext", () => ({ useAuth: vi.fn() }));
const call: PlainCall = {
  id: "call",
  channelId: "channel",
  callType: "CHANNEL",
  hostUserId: "host",
  initiatorUserId: "host",
  startedAtSeconds: 1,
  participants: [
    {
      userId: "user",
      deviceId: "device",
      identity: "user:device",
      displayName: "Member",
      avatarUrl: null,
      joinedAtSeconds: 2,
      micEnabled: false,
      cameraEnabled: false,
      screenSharing: false,
      handRaisedAt: null,
      handRevision: 2,
    },
  ],
};
describe("call participation cache", () => {
  it("keeps host lowering when an older media event arrives", () => {
    const qc = new QueryClient();
    upsertActiveCall(qc, "org", call);
    applyParticipantEvent(
      qc,
      "org",
      "channel",
      "call",
      {
        ...call.participants[0],
        handRevision: 1,
        handRaisedAt: "2026-10-29T10:00:00.000Z",
        micEnabled: true,
      },
      "state",
    );
    const data = qc.getQueryData<Record<string, PlainCall>>(activeCallsKey("org"));
    expect(data?.channel.participants[0]).toMatchObject({
      handRevision: 2,
      handRaisedAt: null,
      micEnabled: true,
    });
    applyParticipantEvent(qc, "org", "channel", "call", call.participants[0], "left");
    expect(
      qc.getQueryData<Record<string, PlainCall>>(activeCallsKey("org"))?.channel.participants,
    ).toEqual([]);
  });
  it("reconnect restores raised hands from snapshot", () => {
    const qc = new QueryClient();
    const raised = {
      ...call,
      participants: [
        { ...call.participants[0], handRevision: 3, handRaisedAt: "2026-10-29T10:00:00.000Z" },
      ],
    };
    syncActiveCalls(qc, "org", [raised]);
    syncActiveCalls(qc, "org", [call]);
    expect(
      qc.getQueryData<Record<string, PlainCall>>(activeCallsKey("org"))?.channel.participants[0]
        .handRaisedAt,
    ).toBe(raised.participants[0].handRaisedAt);
  });
  it("ignores expired reactions and bounds active reactions", () => {
    const qc = new QueryClient();
    const reaction = {
      id: "expired",
      callId: "call",
      userId: "user",
      displayName: "Member",
      reaction: CallReaction.AGREE,
      expiresAt: 1,
    };
    pushCallReaction(qc, "org", reaction);
    expect(qc.getQueryData(reactionsKey("org"))).toBeUndefined();
    for (let i = 0; i < 10; i++)
      pushCallReaction(qc, "org", { ...reaction, id: String(i), expiresAt: Date.now() + 5000 });
    expect(qc.getQueryData(reactionsKey("org"))).toHaveLength(5);
  });
});
