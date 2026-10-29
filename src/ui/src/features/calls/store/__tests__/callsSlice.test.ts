import { create } from "@bufbuild/protobuf";
import { CallSchema, CallParticipantSchema } from "@uniffy/proto/calls/v1/calls_pb";
import { callToPlain, participantToPlain } from "@/features/calls/api/callsConverters";
import { describe, expect, it } from "vitest";
import {
  callsReducer,
  sessionTerminated,
  feedbackChanged,
  callUpserted,
  callCleared,
  activeCallsSynced,
  callEnded,
  participantUpserted,
  participantLeft,
  hostChanged,
  ringReceived,
  ringDismissed,
  prejoinOpened,
  prejoinClosed,
  sessionConnecting,
  sessionConnected,
  sessionReset,
  clearCalls,
} from "@/features/calls/store/callsSlice";
import type { CallData, CallParticipantData, RingInvite } from "@/features/calls/types";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";

const participant = (over: Partial<CallParticipantData> = {}): CallParticipantData => ({
  userId: "u1",
  deviceId: "d1",
  identity: "u1:d1",
  displayName: "Alice",
  avatarUrl: null,
  deviceLabel: null,
  joinedAt: "2026-07-08T10:00:00.000Z",
  micEnabled: true,
  cameraEnabled: false,
  screenSharing: false,
  ...over,
});

const call = (over: Partial<CallData> = {}): CallData => ({
  id: "call-1",
  organizationId: "org-1",
  channelId: "chan-1",
  callType: "CHANNEL",
  initiatorUserId: "u1",
  hostUserId: "u1",
  startedAt: "2026-07-08T10:00:00.000Z",
  endedAt: null,
  endReason: null,
  participants: [participant()],
  ...over,
});

const invite = (over: Partial<RingInvite> = {}): RingInvite => ({
  callId: "call-1",
  channelId: "chan-1",
  channelName: "general",
  callType: "DIRECT",
  callerUserId: "u1",
  callerName: "Alice",
  callerAvatarUrl: null,
  expiresAt: null,
  ...over,
});

const init = () => callsReducer(undefined, { type: "init" });

describe("callsSlice", () => {
  it("upserts an active call and drops it when it ends", () => {
    let state = callsReducer(init(), callUpserted(call()));
    expect(state.activeByChannel["chan-1"].id).toBe("call-1");

    state = callsReducer(
      state,
      callEnded({ callId: "call-1", channelId: "chan-1", reason: "ALL_LEFT" }),
    );
    expect(state.activeByChannel["chan-1"]).toBeUndefined();
    expect(state.endedInfo).toBeNull();
  });

  it("sets endedInfo only when the user was in the ended call", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      sessionConnecting({
        callId: "call-1",
        channelId: "chan-1",
        screenShareQualityCap: ScreenShareQuality.UNSPECIFIED,
      }),
    );
    state = callsReducer(state, sessionConnected());
    state = callsReducer(
      state,
      callEnded({ callId: "call-1", channelId: "chan-1", reason: "HOST_ENDED" }),
    );
    expect(state.endedInfo).toEqual({
      callId: "call-1",
      channelId: "chan-1",
      reason: "HOST_ENDED",
    });
  });

  it("upserts and removes participants by identity", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      participantUpserted({
        callId: "call-1",
        participant: participant({ identity: "u2:d9", userId: "u2", displayName: "Bob" }),
      }),
    );
    expect(state.activeByChannel["chan-1"].participants).toHaveLength(2);

    state = callsReducer(
      state,
      participantUpserted({
        callId: "call-1",
        participant: participant({ micEnabled: false }),
      }),
    );
    expect(state.activeByChannel["chan-1"].participants).toHaveLength(2);
    expect(
      state.activeByChannel["chan-1"].participants.find((p) => p.identity === "u1:d1")?.micEnabled,
    ).toBe(false);

    state = callsReducer(state, participantLeft({ callId: "call-1", identity: "u1:d1" }));
    expect(state.activeByChannel["chan-1"].participants.map((p) => p.identity)).toEqual(["u2:d9"]);
  });

  it("promotes the new host", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, hostChanged({ callId: "call-1", newHostUserId: "u2" }));
    expect(state.activeByChannel["chan-1"].hostUserId).toBe("u2");
  });

  it("deduplicates ring invites and never rings for the current call", () => {
    let state = callsReducer(init(), ringReceived(invite()));
    state = callsReducer(state, ringReceived(invite()));
    expect(state.ringInvites).toHaveLength(1);

    state = callsReducer(state, ringDismissed("call-1"));
    expect(state.ringInvites).toHaveLength(0);

    state = callsReducer(
      state,
      sessionConnecting({
        callId: "call-2",
        channelId: "chan-2",
        screenShareQualityCap: ScreenShareQuality.UNSPECIFIED,
      }),
    );
    state = callsReducer(state, ringReceived(invite({ callId: "call-2" })));
    expect(state.ringInvites).toHaveLength(0);
  });

  it("clears ring invites for a call that ended (missed)", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, ringReceived(invite()));
    state = callsReducer(
      state,
      callEnded({ callId: "call-1", channelId: "chan-1", reason: "ALL_LEFT" }),
    );
    expect(state.ringInvites).toHaveLength(0);
  });

  it("clears a stale call entry for a channel", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, callCleared("chan-1"));
    expect(state.activeByChannel["chan-1"]).toBeUndefined();
  });

  it("replaces indicator state wholesale on sync", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, callUpserted(call({ id: "call-2", channelId: "chan-2" })));
    state = callsReducer(state, ringReceived(invite()));

    state = callsReducer(state, activeCallsSynced([call({ id: "call-3", channelId: "chan-3" })]));
    expect(Object.keys(state.activeByChannel)).toEqual(["chan-3"]);
    // The invite's call is no longer active; the ring dies with it.
    expect(state.ringInvites).toHaveLength(0);
  });

  it("surfaces endedInfo when the session call vanished from a sync", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      sessionConnecting({
        callId: "call-1",
        channelId: "chan-1",
        screenShareQualityCap: ScreenShareQuality.UNSPECIFIED,
      }),
    );
    state = callsReducer(state, sessionConnected());

    state = callsReducer(state, activeCallsSynced([]));
    expect(state.activeByChannel["chan-1"]).toBeUndefined();
    expect(state.endedInfo).toEqual({ callId: "call-1", channelId: "chan-1", reason: null });
  });

  it("keeps the session untouched when a sync still contains its call", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      sessionConnecting({
        callId: "call-1",
        channelId: "chan-1",
        screenShareQualityCap: ScreenShareQuality.UNSPECIFIED,
      }),
    );
    state = callsReducer(state, sessionConnected());

    state = callsReducer(state, activeCallsSynced([call()]));
    expect(state.endedInfo).toBeNull();
    expect(state.session.status).toBe("connected");
  });

  it("resets the session to idle", () => {
    let state = callsReducer(
      init(),
      sessionConnecting({
        callId: "call-1",
        channelId: "chan-1",
        screenShareQualityCap: ScreenShareQuality.UNSPECIFIED,
      }),
    );
    state = callsReducer(state, sessionReset());
    expect(state.session.status).toBe("idle");
    expect(state.session.callId).toBeNull();
  });

  it("keeps the rung call's identity through the prejoin", () => {
    let state = callsReducer(init(), prejoinOpened({ channelId: "chan-1", callId: "call-9" }));
    expect(state.prejoin).toEqual({ channelId: "chan-1", callId: "call-9" });
    state = callsReducer(state, prejoinClosed());
    expect(state.prejoin).toBeNull();
  });

  it("opens a channel-initiated prejoin without a call identity", () => {
    const state = callsReducer(init(), prejoinOpened({ channelId: "chan-1" }));
    expect(state.prejoin).toEqual({ channelId: "chan-1", callId: null });
  });

  it("wipes every slice field on sign-out", () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      sessionConnecting({
        callId: "call-1",
        channelId: "chan-1",
        screenShareQualityCap: ScreenShareQuality.UNSPECIFIED,
      }),
    );
    state = callsReducer(state, sessionConnected());
    state = callsReducer(state, ringReceived(invite({ callId: "call-9" })));

    state = callsReducer(state, clearCalls());
    expect(state.activeByChannel).toEqual({});
    expect(state.ringInvites).toHaveLength(0);
    expect(state.endedInfo).toBeNull();
    expect(state.prejoin).toBeNull();
    expect(state.session.status).toBe("idle");
    expect(state.session.callId).toBeNull();
  });
});

describe("terminal event ordering", () => {
  const connected = () =>
    callsReducer(
      callsReducer(
        undefined,
        sessionConnecting({
          callId: "call-1",
          channelId: "chan-1",
          screenShareQualityCap: ScreenShareQuality.BALANCED,
        }),
      ),
      sessionConnected(),
    );
  it("fills a room-deletion reason even after SDK reset", () => {
    const disconnected = callsReducer(
      connected(),
      sessionTerminated({ callId: "call-1", channelId: "chan-1", reason: null }),
    );
    const ended = callsReducer(
      disconnected,
      callEnded({ callId: "call-1", channelId: "chan-1", reason: "MAX_DURATION" }),
    );
    expect(ended.endedInfo?.reason).toBe("MAX_DURATION");
    expect(ended.session.status).toBe("idle");
  });
  it("preserves an end reason received before the SDK disconnect", () => {
    const ended = callsReducer(
      connected(),
      callEnded({ callId: "call-1", channelId: "chan-1", reason: "HOST_ENDED" }),
    );
    expect(
      callsReducer(
        ended,
        sessionTerminated({ callId: "call-1", channelId: "chan-1", reason: null }),
      ).endedInfo?.reason,
    ).toBe("HOST_ENDED");
  });
  it("does not replace removal or displacement with a later all-left event", () => {
    for (const reason of ["KICKED", "DISPLACED"] as const) {
      const disconnected = callsReducer(
        connected(),
        sessionTerminated({ callId: "call-1", channelId: "chan-1", reason }),
      );
      expect(
        callsReducer(
          disconnected,
          callEnded({ callId: "call-1", channelId: "chan-1", reason: "ALL_LEFT" }),
        ).endedInfo?.reason,
      ).toBe(reason);
    }
  });
  it("ignores another call's disconnect and clears feedback on sign-out", () => {
    expect(
      callsReducer(
        connected(),
        sessionTerminated({ callId: "other", channelId: "other", reason: "KICKED" }),
      ).session.status,
    ).toBe("connected");
    const withFeedback = callsReducer(connected(), feedbackChanged("Muted"));
    expect(callsReducer(withFeedback, clearCalls()).feedback).toBeNull();
    expect(callsReducer(withFeedback, sessionReset()).feedback).toBeNull();
    expect(
      callsReducer(
        withFeedback,
        sessionTerminated({ callId: "call-1", channelId: "chan-1", reason: "KICKED" }),
      ).feedback,
    ).toBeNull();
  });
});

describe("hand ordering", () => {
  it("keeps a lowered hand when an older media update arrives", () => {
    let state = callsReducer(
      init(),
      callUpserted(call({ participants: [participant({ handRaisedAt: null, handRevision: 2 })] })),
    );
    state = callsReducer(
      state,
      participantUpserted({
        callId: "call-1",
        participant: participant({
          handRaisedAt: "2026-07-08T10:01:00.000Z",
          handRevision: 1,
          cameraEnabled: true,
        }),
      }),
    );
    expect(state.activeByChannel["chan-1"].participants[0]).toMatchObject({
      handRaisedAt: null,
      handRevision: 2,
      cameraEnabled: true,
    });
  });
  it("does not inherit a hand from a departed device session", () => {
    let state = callsReducer(
      init(),
      callUpserted(
        call({
          participants: [
            participant({ handRaisedAt: "2026-07-08T10:01:00.000Z", handRevision: 3 }),
          ],
        }),
      ),
    );
    state = callsReducer(
      state,
      participantUpserted({
        callId: "call-1",
        participant: participant({
          joinedAt: "2026-07-08T11:00:00.000Z",
          handRaisedAt: null,
          handRevision: 0,
        }),
      }),
    );
    expect(state.activeByChannel["chan-1"].participants[0].handRaisedAt).toBeNull();
  });
});

it("preserves subsecond raise order", () => {
  const first = participantToPlain(
    create(CallParticipantSchema, { handRaisedAt: { seconds: 100n, nanos: 100000000 } }),
  );
  const second = participantToPlain(
    create(CallParticipantSchema, { handRaisedAt: { seconds: 100n, nanos: 250000000 } }),
  );
  expect(first.handRaisedAt! < second.handRaisedAt!).toBe(true);
});

it("does not restore a lowered hand from an older reconnect snapshot", () => {
  const initial = callsReducer(
    init(),
    callUpserted(call({ participants: [participant({ handRaisedAt: null, handRevision: 2 })] })),
  );
  const stale = call({
    participants: [participant({ handRaisedAt: "2026-07-08T10:01:00.000Z", handRevision: 1 })],
  });
  expect(
    callsReducer(initial, callUpserted(stale)).activeByChannel["chan-1"].participants[0]
      .handRaisedAt,
  ).toBeNull();
  expect(
    callsReducer(initial, activeCallsSynced([stale])).activeByChannel["chan-1"].participants[0]
      .handRaisedAt,
  ).toBeNull();
});

describe("call publishing snapshots", () => {
  it("converts speaker policy from join and stream payloads", () => {
    const snapshot = callToPlain(
      create(CallSchema, {
        townHall: true,
        hostUserId: "host",
        speakerUserIds: ["speaker"],
        publishingRevision: 7,
      }),
    );
    expect(snapshot).toMatchObject({
      townHall: true,
      hostUserId: "host",
      speakerUserIds: ["speaker"],
      publishingRevision: 7,
    });
  });
  it("keeps demotion across delayed joins and reconnect snapshots", () => {
    const current = call({ townHall: true, speakerUserIds: [], publishingRevision: 4 });
    const stale = call({ townHall: false, speakerUserIds: ["u2"], publishingRevision: 3 });
    let state = callsReducer(init(), callUpserted(current));
    state = callsReducer(state, callUpserted(stale));
    state = callsReducer(state, activeCallsSynced([stale]));
    state = callsReducer(
      state,
      hostChanged({ callId: "call-1", newHostUserId: "departed", publishingRevision: 3 }),
    );
    expect(state.activeByChannel["chan-1"].hostUserId).toBe("u1");
    expect(state.activeByChannel["chan-1"]).toMatchObject({
      townHall: true,
      speakerUserIds: [],
      publishingRevision: 4,
    });
    state = callsReducer(state, callUpserted({ ...stale, publishingRevision: 5 }));
    expect(state.activeByChannel["chan-1"].townHall).toBe(false);
  });
});
