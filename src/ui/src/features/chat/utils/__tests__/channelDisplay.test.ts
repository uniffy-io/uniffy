import { describe, it, expect } from 'vitest';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import type { ChatChannel } from '@/features/chat/types';

function buildChannel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: 'cid',
    organizationId: 'oid',
    ownerId: 'uid',
    name: 'Acme Agent',
    slug: 'acme-agent',
    description: '',
    channelType: 'DIRECT',
    categoryId: null,
    isEncrypted: false,
    isArchived: false,
    isDefault: false,
    isDeleted: false,
    icon: null,
    createdAt: '',
    updatedAt: '',
    messageCount: 0,
    rootMessageCount: 0,
    lastMessageAt: null,
    lastRootMessageAt: null,
    memberCount: 2,
    dmMemberIds: [],
    isAgentDm: true,
    ...overrides,
  };
}

describe('getChannelDisplayName', () => {
  it('returns the auto-generated name when no custom name is set', () => {
    expect(getChannelDisplayName(buildChannel())).toBe('Acme Agent');
  });

  it('prefers the custom name when set', () => {
    expect(
      getChannelDisplayName(buildChannel({ customName: 'Onboarding plan' })),
    ).toBe('Onboarding plan');
  });

  it('falls back to the auto-generated name on whitespace-only custom names', () => {
    expect(
      getChannelDisplayName(buildChannel({ customName: '   ' })),
    ).toBe('Acme Agent');
  });

  it('trims surrounding whitespace from the custom name', () => {
    expect(
      getChannelDisplayName(buildChannel({ customName: '  Sprint review  ' })),
    ).toBe('Sprint review');
  });
});
