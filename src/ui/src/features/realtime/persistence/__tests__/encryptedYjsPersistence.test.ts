import { describe, it, expect } from 'vitest';
import {
  HYDRATION_ORIGIN,
  MARKDOWN_MIRROR_ORIGIN,
  REMOTE_ORIGIN,
  isPersistedOrigin,
  newPersistenceEpoch,
  selectCompactableSeqs,
  updateRowSeq,
} from '@/features/realtime/persistence/encryptedYjsPersistence';

describe('newPersistenceEpoch', () => {
  it('produces a distinct epoch per attach', () => {
    expect(newPersistenceEpoch()).not.toBe(newPersistenceEpoch());
  });
});

describe('updateRowSeq', () => {
  it('never collides across epochs for the same counter', () => {
    const a = newPersistenceEpoch();
    const b = newPersistenceEpoch();
    expect(updateRowSeq(a, 1)).not.toBe(updateRowSeq(b, 1));
  });

  it('keeps write order lexicographically within one epoch', () => {
    const epoch = 'e';
    const seqs = [10, 2, 1].map((n) => updateRowSeq(epoch, n));
    expect([...seqs].sort()).toEqual([
      updateRowSeq(epoch, 1),
      updateRowSeq(epoch, 2),
      updateRowSeq(epoch, 10),
    ]);
  });

  it('gives two sessions on the same doc fully disjoint row keys', () => {
    const a = newPersistenceEpoch();
    const b = newPersistenceEpoch();
    const rows = new Map<string, string>();
    for (let n = 1; n <= 3; n++) rows.set(updateRowSeq(a, n), `a${n}`);
    for (let n = 1; n <= 3; n++) rows.set(updateRowSeq(b, n), `b${n}`);
    expect(rows.size).toBe(6);
  });
});

describe('isPersistedOrigin', () => {
  it('filters hydration, remote, and markdown-mirror origins', () => {
    expect(isPersistedOrigin(HYDRATION_ORIGIN)).toBe(false);
    expect(isPersistedOrigin(REMOTE_ORIGIN)).toBe(false);
    expect(isPersistedOrigin(MARKDOWN_MIRROR_ORIGIN)).toBe(false);
  });

  it('persists session-id and untagged origins', () => {
    expect(isPersistedOrigin('some-session-uuid')).toBe(true);
    expect(isPersistedOrigin(null)).toBe(true);
    expect(isPersistedOrigin(undefined)).toBe(true);
  });
});

describe('selectCompactableSeqs', () => {
  const own = 'epoch-own';
  const other = 'epoch-other';

  it('selects own rows up to the captured counter only', () => {
    const seqs = [1, 2, 3].map((n) => updateRowSeq(own, n));
    const picked = selectCompactableSeqs(seqs, own, 2, new Set());
    expect(picked).toEqual([updateRowSeq(own, 1), updateRowSeq(own, 2)]);
  });

  it('never selects another session rows that were not hydrated', () => {
    const seqs = [
      updateRowSeq(other, 1),
      updateRowSeq(other, 2),
      updateRowSeq(own, 1),
    ];
    const picked = selectCompactableSeqs(seqs, own, 5, new Set());
    expect(picked).toEqual([updateRowSeq(own, 1)]);
  });

  it('selects hydrated rows regardless of epoch', () => {
    const hydrated = new Set([updateRowSeq(other, 1)]);
    const seqs = [updateRowSeq(other, 1), updateRowSeq(other, 2)];
    const picked = selectCompactableSeqs(seqs, own, 0, hydrated);
    expect(picked).toEqual([updateRowSeq(other, 1)]);
  });

  it('leaves a prior uncompacted session intact for a fresh attach that has not hydrated', () => {
    const priorRows = [1, 2, 3].map((n) => updateRowSeq(other, n));
    const picked = selectCompactableSeqs(priorRows, newPersistenceEpoch(), 100, new Set());
    expect(picked).toEqual([]);
  });
});
