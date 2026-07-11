import { describe, expect, it } from 'vitest';
import {
  callsReducer,
  callUpserted,
  callCleared,
  activeCallsSynced,
  callEnded,
  participantUpserted,
  participantLeft,
  hostChanged,
  ringReceived,
  ringDismissed,
  sessionConnecting,
  sessionConnected,
  sessionReset,
  clearCalls,
} from '@/features/calls/store/callsSlice';
import type { CallData, CallParticipantData, RingInvite } from '@/features/calls/types';
import { ScreenShareQuality } from '@uniffy/proto/calls/v1/calls_pb';

const participant = (over: Partial<CallParticipantData> = {}): CallParticipantData => ({
  userId: 'u1',
  deviceId: 'd1',
  identity: 'u1:d1',
  displayName: 'Alice',
  avatarUrl: null,
  deviceLabel: null,
  joinedAt: '2026-07-08T10:00:00.000Z',
  micEnabled: true,
  cameraEnabled: false,
  screenSharing: false,
  ...over,
});

const call = (over: Partial<CallData> = {}): CallData => ({
  id: 'call-1',
  organizationId: 'org-1',
  channelId: 'chan-1',
  callType: 'CHANNEL',
  initiatorUserId: 'u1',
  hostUserId: 'u1',
  startedAt: '2026-07-08T10:00:00.000Z',
  endedAt: null,
  endReason: null,
  participants: [participant()],
  ...over,
});

const invite = (over: Partial<RingInvite> = {}): RingInvite => ({
  callId: 'call-1',
  channelId: 'chan-1',
  channelName: 'general',
  callType: 'DIRECT',
  callerUserId: 'u1',
  callerName: 'Alice',
  callerAvatarUrl: null,
  expiresAt: null,
  ...over,
});

const init = () => callsReducer(undefined, { type: 'init' });

describe('callsSlice', () => {
  it('upserts an active call and drops it when it ends', () => {
    let state = callsReducer(init(), callUpserted(call()));
    expect(state.activeByChannel['chan-1'].id).toBe('call-1');

    state = callsReducer(
      state,
      callEnded({ callId: 'call-1', channelId: 'chan-1', reason: 'ALL_LEFT' }),
    );
    expect(state.activeByChannel['chan-1']).toBeUndefined();
    expect(state.endedInfo).toBeNull();
  });

  it('sets endedInfo only when the user was in the ended call', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, sessionConnecting({ callId: 'call-1', channelId: 'chan-1', screenShareQualityCap: ScreenShareQuality.UNSPECIFIED }));
    state = callsReducer(state, sessionConnected());
    state = callsReducer(
      state,
      callEnded({ callId: 'call-1', channelId: 'chan-1', reason: 'HOST_ENDED' }),
    );
    expect(state.endedInfo).toEqual({
      callId: 'call-1',
      channelId: 'chan-1',
      reason: 'HOST_ENDED',
    });
  });

  it('upserts and removes participants by identity', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      participantUpserted({
        callId: 'call-1',
        participant: participant({ identity: 'u2:d9', userId: 'u2', displayName: 'Bob' }),
      }),
    );
    expect(state.activeByChannel['chan-1'].participants).toHaveLength(2);

    state = callsReducer(
      state,
      participantUpserted({
        callId: 'call-1',
        participant: participant({ micEnabled: false }),
      }),
    );
    expect(state.activeByChannel['chan-1'].participants).toHaveLength(2);
    expect(
      state.activeByChannel['chan-1'].participants.find((p) => p.identity === 'u1:d1')
        ?.micEnabled,
    ).toBe(false);

    state = callsReducer(state, participantLeft({ callId: 'call-1', identity: 'u1:d1' }));
    expect(state.activeByChannel['chan-1'].participants.map((p) => p.identity)).toEqual([
      'u2:d9',
    ]);
  });

  it('promotes the new host', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, hostChanged({ callId: 'call-1', newHostUserId: 'u2' }));
    expect(state.activeByChannel['chan-1'].hostUserId).toBe('u2');
  });

  it('deduplicates ring invites and never rings for the current call', () => {
    let state = callsReducer(init(), ringReceived(invite()));
    state = callsReducer(state, ringReceived(invite()));
    expect(state.ringInvites).toHaveLength(1);

    state = callsReducer(state, ringDismissed('call-1'));
    expect(state.ringInvites).toHaveLength(0);

    state = callsReducer(state, sessionConnecting({ callId: 'call-2', channelId: 'chan-2', screenShareQualityCap: ScreenShareQuality.UNSPECIFIED }));
    state = callsReducer(state, ringReceived(invite({ callId: 'call-2' })));
    expect(state.ringInvites).toHaveLength(0);
  });

  it('clears ring invites for a call that ended (missed)', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, ringReceived(invite()));
    state = callsReducer(
      state,
      callEnded({ callId: 'call-1', channelId: 'chan-1', reason: 'ALL_LEFT' }),
    );
    expect(state.ringInvites).toHaveLength(0);
  });

  it('clears a stale call entry for a channel', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, callCleared('chan-1'));
    expect(state.activeByChannel['chan-1']).toBeUndefined();
  });

  it('replaces indicator state wholesale on sync', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(
      state,
      callUpserted(call({ id: 'call-2', channelId: 'chan-2' })),
    );
    state = callsReducer(state, ringReceived(invite()));

    state = callsReducer(
      state,
      activeCallsSynced([call({ id: 'call-3', channelId: 'chan-3' })]),
    );
    expect(Object.keys(state.activeByChannel)).toEqual(['chan-3']);
    // The invite's call is no longer active; the ring dies with it.
    expect(state.ringInvites).toHaveLength(0);
  });

  it('surfaces endedInfo when the session call vanished from a sync', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, sessionConnecting({ callId: 'call-1', channelId: 'chan-1', screenShareQualityCap: ScreenShareQuality.UNSPECIFIED }));
    state = callsReducer(state, sessionConnected());

    state = callsReducer(state, activeCallsSynced([]));
    expect(state.activeByChannel['chan-1']).toBeUndefined();
    expect(state.endedInfo).toEqual({ callId: 'call-1', channelId: 'chan-1', reason: null });
  });

  it('keeps the session untouched when a sync still contains its call', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, sessionConnecting({ callId: 'call-1', channelId: 'chan-1', screenShareQualityCap: ScreenShareQuality.UNSPECIFIED }));
    state = callsReducer(state, sessionConnected());

    state = callsReducer(state, activeCallsSynced([call()]));
    expect(state.endedInfo).toBeNull();
    expect(state.session.status).toBe('connected');
  });

  it('resets the session to idle', () => {
    let state = callsReducer(init(), sessionConnecting({ callId: 'call-1', channelId: 'chan-1', screenShareQualityCap: ScreenShareQuality.UNSPECIFIED }));
    state = callsReducer(state, sessionReset());
    expect(state.session.status).toBe('idle');
    expect(state.session.callId).toBeNull();
  });

  it('wipes every slice field on sign-out', () => {
    let state = callsReducer(init(), callUpserted(call()));
    state = callsReducer(state, sessionConnecting({ callId: 'call-1', channelId: 'chan-1', screenShareQualityCap: ScreenShareQuality.UNSPECIFIED }));
    state = callsReducer(state, sessionConnected());
    state = callsReducer(state, ringReceived(invite({ callId: 'call-9' })));

    state = callsReducer(state, clearCalls());
    expect(state.activeByChannel).toEqual({});
    expect(state.ringInvites).toHaveLength(0);
    expect(state.endedInfo).toBeNull();
    expect(state.prejoinChannelId).toBeNull();
    expect(state.session.status).toBe('idle');
    expect(state.session.callId).toBeNull();
  });
});
