import { describe, it, expect } from 'vitest';
import {
  chatDraftsReducer,
  setDrafts,
  draftUpserted,
  draftRemoved,
  clearChatDrafts,
  draftKey,
  selectChannelsWithDrafts,
} from '@/features/chat/store/chatDraftsSlice';
import type { PlainDraft } from '@/features/chat/api/chatConverters';
import type { RootState } from '@/app/store';

function buildDraft(overrides: Partial<PlainDraft> = {}): PlainDraft {
  return {
    channelId: 'ch-1',
    rootMessageId: null,
    content: 'hello',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

function toRootState(byKey: Record<string, { content: string; updatedAt: string }>): RootState {
  return { chatDrafts: { byKey } } as unknown as RootState;
}

const emptyState = chatDraftsReducer(undefined, { type: 'test/init' });

describe('draftKey', () => {
  it('uses the channel id alone for channel drafts', () => {
    expect(draftKey('ch-1')).toBe('ch-1');
    expect(draftKey('ch-1', undefined)).toBe('ch-1');
  });

  it('appends the root message id for thread drafts', () => {
    expect(draftKey('ch-1', 'root-9')).toBe('ch-1:root-9');
  });
});

describe('chatDraftsSlice reducers', () => {
  it('setDrafts replaces the map, keying thread drafts by channel and root', () => {
    const seeded = chatDraftsReducer(
      emptyState,
      draftUpserted(buildDraft({ channelId: 'stale', content: 'old' })),
    );
    const state = chatDraftsReducer(
      seeded,
      setDrafts([
        buildDraft({ channelId: 'ch-1', content: 'channel text' }),
        buildDraft({ channelId: 'ch-2', rootMessageId: 'root-9', content: 'thread text' }),
      ]),
    );
    expect(state.byKey).toEqual({
      'ch-1': { content: 'channel text', updatedAt: '2026-07-16T00:00:00.000Z' },
      'ch-2:root-9': { content: 'thread text', updatedAt: '2026-07-16T00:00:00.000Z' },
    });
  });

  it('draftUpserted adds a new entry and overwrites an existing one', () => {
    let state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    expect(state.byKey['ch-1']).toEqual({
      content: 'hello',
      updatedAt: '2026-07-16T00:00:00.000Z',
    });

    state = chatDraftsReducer(
      state,
      draftUpserted(buildDraft({ content: 'hello again', updatedAt: '2026-07-16T01:00:00.000Z' })),
    );
    expect(state.byKey['ch-1']).toEqual({
      content: 'hello again',
      updatedAt: '2026-07-16T01:00:00.000Z',
    });
  });

  it('keeps channel and thread drafts of the same channel independent', () => {
    let state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    state = chatDraftsReducer(
      state,
      draftUpserted(buildDraft({ rootMessageId: 'root-9', content: 'thread reply' })),
    );
    expect(state.byKey['ch-1'].content).toBe('hello');
    expect(state.byKey['ch-1:root-9'].content).toBe('thread reply');
  });

  it('draftRemoved deletes only the given key', () => {
    let state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    state = chatDraftsReducer(
      state,
      draftUpserted(buildDraft({ rootMessageId: 'root-9', content: 'thread reply' })),
    );
    state = chatDraftsReducer(state, draftRemoved(draftKey('ch-1', 'root-9')));
    expect(state.byKey['ch-1:root-9']).toBeUndefined();
    expect(state.byKey['ch-1'].content).toBe('hello');
  });

  it('draftRemoved on a missing key leaves the map unchanged', () => {
    const state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    const next = chatDraftsReducer(state, draftRemoved('unknown'));
    expect(next.byKey).toEqual(state.byKey);
  });

  it('clearChatDrafts resets to the initial state', () => {
    const state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    expect(chatDraftsReducer(state, clearChatDrafts())).toEqual(emptyState);
  });
});

describe('selectChannelsWithDrafts', () => {
  it('counts thread drafts toward their channel', () => {
    const channels = selectChannelsWithDrafts(
      toRootState({
        'ch-1': { content: 'a', updatedAt: '2026-07-16T00:00:00.000Z' },
        'ch-2:root-9': { content: 'b', updatedAt: '2026-07-16T00:00:00.000Z' },
      }),
    );
    expect(channels).toEqual(new Set(['ch-1', 'ch-2']));
  });

  it('dedupes a channel that has both a channel and a thread draft', () => {
    const channels = selectChannelsWithDrafts(
      toRootState({
        'ch-1': { content: 'a', updatedAt: '2026-07-16T00:00:00.000Z' },
        'ch-1:root-9': { content: 'b', updatedAt: '2026-07-16T00:00:00.000Z' },
      }),
    );
    expect(channels).toEqual(new Set(['ch-1']));
  });

  it('returns an empty set when there are no drafts', () => {
    expect(selectChannelsWithDrafts(toRootState({}))).toEqual(new Set());
  });
});
