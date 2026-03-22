import { type ChatReaction } from '@/features/chat/mock/types';
import { CURRENT_USER_ID } from '@/features/chat/mock/mockMembers';

export const MOCK_REACTIONS: ChatReaction[] = [
  // msg-g-001: All-hands reminder
  { id: 'rxn-001', messageId: 'msg-g-001', userId: 'user-002', emoji: 'thumbs_up', createdAt: '2026-03-22T08:01:00Z' },
  { id: 'rxn-002', messageId: 'msg-g-001', userId: 'user-004', emoji: 'thumbs_up', createdAt: '2026-03-22T08:02:00Z' },
  { id: 'rxn-003', messageId: 'msg-g-001', userId: 'user-007', emoji: 'thumbs_up', createdAt: '2026-03-22T08:05:00Z' },
  { id: 'rxn-004', messageId: 'msg-g-001', userId: 'user-005', emoji: 'check', createdAt: '2026-03-22T08:06:00Z' },

  // msg-g-004: Design mockups
  { id: 'rxn-005', messageId: 'msg-g-004', userId: 'user-001', emoji: 'fire', createdAt: '2026-03-22T08:16:00Z' },
  { id: 'rxn-006', messageId: 'msg-g-004', userId: 'user-002', emoji: 'fire', createdAt: '2026-03-22T08:17:00Z' },
  { id: 'rxn-007', messageId: 'msg-g-004', userId: 'user-005', emoji: 'fire', createdAt: '2026-03-22T08:18:00Z' },
  { id: 'rxn-008', messageId: 'msg-g-004', userId: 'user-006', emoji: 'heart', createdAt: '2026-03-22T08:20:00Z' },
  { id: 'rxn-009', messageId: 'msg-g-004', userId: 'user-001', emoji: 'eyes', createdAt: '2026-03-22T08:16:30Z' },

  // msg-g-009: DAU numbers
  { id: 'rxn-010', messageId: 'msg-g-009', userId: 'user-001', emoji: 'party', createdAt: '2026-03-22T09:06:00Z' },
  { id: 'rxn-011', messageId: 'msg-g-009', userId: 'user-002', emoji: 'party', createdAt: '2026-03-22T09:07:00Z' },
  { id: 'rxn-012', messageId: 'msg-g-009', userId: 'user-004', emoji: 'party', createdAt: '2026-03-22T09:08:00Z' },

  // msg-g-011: Deployment freeze (pinned)
  { id: 'rxn-013', messageId: 'msg-g-011', userId: 'user-003', emoji: 'thumbs_up', createdAt: '2026-03-22T09:31:00Z' },
  { id: 'rxn-014', messageId: 'msg-g-011', userId: 'user-005', emoji: 'thumbs_up', createdAt: '2026-03-22T09:32:00Z' },
  { id: 'rxn-015', messageId: 'msg-g-011', userId: 'user-007', emoji: 'check', createdAt: '2026-03-22T09:33:00Z' },
  { id: 'rxn-016', messageId: 'msg-g-011', userId: 'user-008', emoji: 'check', createdAt: '2026-03-22T09:34:00Z' },

  // msg-e-004: WebSocket PR
  { id: 'rxn-017', messageId: 'msg-e-004', userId: 'user-003', emoji: 'eyes', createdAt: '2026-03-21T15:32:00Z' },
  { id: 'rxn-018', messageId: 'msg-e-004', userId: 'user-007', emoji: 'eyes', createdAt: '2026-03-21T15:35:00Z' },
  { id: 'rxn-019', messageId: 'msg-e-004', userId: 'user-001', emoji: 'thumbs_up', createdAt: '2026-03-21T15:40:00Z' },

  // msg-e-007: Migration merged
  { id: 'rxn-020', messageId: 'msg-e-007', userId: 'user-001', emoji: 'check', createdAt: '2026-03-22T08:05:00Z' },
  { id: 'rxn-021', messageId: 'msg-e-007', userId: 'user-003', emoji: 'thumbs_up', createdAt: '2026-03-22T08:06:00Z' },

  // msg-e-012: WebSocket PR approved
  { id: 'rxn-022', messageId: 'msg-e-012', userId: 'user-005', emoji: 'heart', createdAt: '2026-03-22T09:02:00Z' },
  { id: 'rxn-023', messageId: 'msg-e-012', userId: 'user-001', emoji: 'party', createdAt: '2026-03-22T09:03:00Z' },

  // msg-e-013: Load test results (agent message)
  { id: 'rxn-024', messageId: 'msg-e-013', userId: 'user-001', emoji: 'eyes', createdAt: '2026-03-22T09:16:00Z' },
  { id: 'rxn-025', messageId: 'msg-e-013', userId: 'user-003', emoji: 'thumbs_up', createdAt: '2026-03-22T09:17:00Z' },
  { id: 'rxn-026', messageId: 'msg-e-013', userId: 'user-007', emoji: 'laughing', createdAt: '2026-03-22T09:18:00Z' },

  // msg-g-013: Team lunch reminder
  { id: 'rxn-027', messageId: 'msg-g-013', userId: 'user-001', emoji: 'thumbs_up', createdAt: '2026-03-22T10:31:00Z' },
  { id: 'rxn-028', messageId: 'msg-g-013', userId: 'user-004', emoji: 'heart', createdAt: '2026-03-22T10:31:30Z' },
  { id: 'rxn-029', messageId: 'msg-g-013', userId: 'user-006', emoji: 'party', createdAt: '2026-03-22T10:32:00Z' },
  { id: 'rxn-030', messageId: 'msg-g-013', userId: 'user-007', emoji: 'thumbs_up', createdAt: '2026-03-22T10:35:00Z' },
];

// Get all reactions for a specific message
export function getReactionsForMessage(messageId: string): ChatReaction[] {
  return MOCK_REACTIONS.filter(r => r.messageId === messageId);
}

// Group reactions by emoji for display, including whether the current user reacted
export function getGroupedReactions(
  messageId: string,
): { emoji: string; count: number; userIds: string[]; hasCurrentUser: boolean }[] {
  const reactions = getReactionsForMessage(messageId);
  const groups = new Map<string, string[]>();

  for (const reaction of reactions) {
    const existing = groups.get(reaction.emoji);
    if (existing) {
      existing.push(reaction.userId);
    } else {
      groups.set(reaction.emoji, [reaction.userId]);
    }
  }

  return Array.from(groups.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    userIds,
    hasCurrentUser: userIds.includes(CURRENT_USER_ID),
  }));
}
