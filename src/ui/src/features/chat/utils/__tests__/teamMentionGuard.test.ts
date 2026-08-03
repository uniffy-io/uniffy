import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEAM_MENTION_CONFIRM_THRESHOLD,
  needsTeamMentionConfirm,
  resolveTeamMentionTotal,
  teamMentionsIn,
} from '@/features/chat/utils/teamMentionGuard';
import { getMentionState } from '@/components/mention/mentionStateEmitter';
import { getCachedPreview, resolveUrnBatched } from '@/components/mention/useBatchedSubjectResolver';

vi.mock('@/components/mention/mentionStateEmitter', () => ({
  getMentionState: vi.fn(),
}));

vi.mock('@/components/mention/useBatchedSubjectResolver', () => ({
  getCachedPreview: vi.fn(),
  resolveUrnBatched: vi.fn(),
}));

const ORG = 'org-1';
const ENG = 'urn:uniffy:content:TEAM:11111111-1111-1111-1111-111111111111';
const DESIGN = 'urn:uniffy:content:TEAM:22222222-2222-2222-2222-222222222222';

describe('teamMentionsIn', () => {
  it('picks TEAM mentions and ignores other types', () => {
    const markdown = [
      `[[[Engineering|${ENG}]]]`,
      '[[[Ada|urn:uniffy:content:USER:33333333-3333-3333-3333-333333333333]]]',
      '[[[Roadmap|urn:uniffy:content:NOTE:44444444-4444-4444-4444-444444444444]]]',
    ].join(' ');

    expect(teamMentionsIn(markdown).map((m) => m.urn)).toEqual([ENG]);
  });

  it('dedupes repeated mentions of the same team', () => {
    const markdown = `[[[Engineering|${ENG}]]] and again [[[Engineering|${ENG}]]]`;
    expect(teamMentionsIn(markdown)).toHaveLength(1);
  });

  it('returns nothing for plain text', () => {
    expect(teamMentionsIn('no mentions here')).toEqual([]);
  });
});

describe('needsTeamMentionConfirm', () => {
  it('does not fire at the threshold', () => {
    expect(needsTeamMentionConfirm(TEAM_MENTION_CONFIRM_THRESHOLD)).toBe(false);
  });

  it('fires one above the threshold', () => {
    expect(needsTeamMentionConfirm(TEAM_MENTION_CONFIRM_THRESHOLD + 1)).toBe(true);
  });

  it('does not fire for an empty mention set', () => {
    expect(needsTeamMentionConfirm(0)).toBe(false);
  });
});

describe('resolveTeamMentionTotal', () => {
  beforeEach(() => {
    vi.mocked(getMentionState).mockReset();
    vi.mocked(getCachedPreview).mockReset();
    vi.mocked(resolveUrnBatched).mockReset();
    vi.mocked(resolveUrnBatched).mockResolvedValue(null);
  });

  it('sums cached live-state counts without resolving', async () => {
    vi.mocked(getMentionState).mockImplementation((urn: string) =>
      ({ urn, teamMemberCount: urn === ENG ? 12 : 4 }),
    );

    const result = await resolveTeamMentionTotal(
      [
        { label: 'Engineering', urn: ENG },
        { label: 'Design', urn: DESIGN },
      ],
      ORG,
    );

    expect(result.total).toBe(16);
    expect(result.labels).toEqual(['Engineering', 'Design']);
    expect(resolveUrnBatched).not.toHaveBeenCalled();
  });

  it('falls back to the batched resolver on a cache miss', async () => {
    vi.mocked(getMentionState).mockReturnValue(null);
    vi.mocked(getCachedPreview).mockReturnValue({
      urn: ENG,
      title: 'Engineering',
      description: '',
      type: 'team' as never,
      metadata: { member_count: '15' },
    });

    const result = await resolveTeamMentionTotal([{ label: 'Engineering', urn: ENG }], ORG);

    expect(resolveUrnBatched).toHaveBeenCalledWith(ENG, ORG);
    expect(result.total).toBe(15);
  });

  it('keeps the label but contributes zero for an unknown count', async () => {
    vi.mocked(getMentionState).mockReturnValue(null);
    vi.mocked(getCachedPreview).mockReturnValue(undefined);

    const result = await resolveTeamMentionTotal([{ label: 'Ghost', urn: ENG }], ORG);

    expect(result.total).toBe(0);
    expect(result.labels).toEqual(['Ghost']);
  });
});
