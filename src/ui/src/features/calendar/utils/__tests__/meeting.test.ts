import { describe, it, expect } from 'vitest';
import { resolveMeetingSubmit, countMissingAttendees } from '@/features/calendar/utils/meeting';

describe('resolveMeetingSubmit', () => {
  it('leaves both sides clear for a plain event with no prior binding', () => {
    expect(resolveMeetingSubmit('none', null, undefined, undefined)).toEqual({
      meetingUrl: '',
      channelId: undefined,
    });
  });

  it('clears a prior channel binding when switching to none', () => {
    expect(resolveMeetingSubmit('none', null, undefined, 'c1')).toEqual({
      meetingUrl: '',
      channelId: '',
    });
  });

  it('binds a link and never a channel', () => {
    expect(resolveMeetingSubmit('link', null, 'https://zoom.test/x', undefined)).toEqual({
      meetingUrl: 'https://zoom.test/x',
      channelId: undefined,
    });
  });

  it('clears a prior channel binding when switching to a link', () => {
    expect(resolveMeetingSubmit('link', null, 'https://zoom.test/x', 'c1')).toEqual({
      meetingUrl: 'https://zoom.test/x',
      channelId: '',
    });
  });

  it('binds a newly picked channel and clears any url', () => {
    expect(resolveMeetingSubmit('channel', 'c2', 'https://zoom.test/x', 'c1')).toEqual({
      meetingUrl: '',
      channelId: 'c2',
    });
  });

  it('omits channel_id on an idempotent re-bind of the same channel', () => {
    expect(resolveMeetingSubmit('channel', 'c1', undefined, 'c1')).toEqual({
      meetingUrl: '',
      channelId: undefined,
    });
  });

  it('clears the binding when the channel is deselected in channel mode', () => {
    expect(resolveMeetingSubmit('channel', null, undefined, 'c1')).toEqual({
      meetingUrl: '',
      channelId: '',
    });
  });
});

describe('countMissingAttendees', () => {
  const members = [
    { subjectType: 'USER' as const, userId: 'u1' },
    { subjectType: 'USER' as const, userId: 'u2' },
    { subjectType: 'AGENT' as const, userId: 'a1' },
  ];

  it('returns 0 for public channels regardless of membership', () => {
    expect(countMissingAttendees('PUBLIC', members, ['u1', 'u9'])).toBe(0);
  });

  it('returns 0 when members have not loaded yet', () => {
    expect(countMissingAttendees('PRIVATE', undefined, ['u1'])).toBe(0);
  });

  it('counts attendees who are not channel members', () => {
    expect(countMissingAttendees('PRIVATE', members, ['u1', 'u3', 'u4'])).toBe(2);
  });

  it('ignores agent members when matching user attendees', () => {
    expect(countMissingAttendees('GROUP_DM', members, ['u1', 'a1'])).toBe(1);
  });

  it('returns 0 when every attendee is a member', () => {
    expect(countMissingAttendees('PRIVATE', members, ['u1', 'u2'])).toBe(0);
  });
});
