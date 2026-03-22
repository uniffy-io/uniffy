import { type ChatResource } from '@/features/chat/mock/types';

export const MOCK_RESOURCES: ChatResource[] = [
  // ---------------------------------------------------------------
  // #general (ch-001) resources
  // ---------------------------------------------------------------

  // Notes
  {
    id: 'res-001',
    channelId: 'ch-001',
    urn: 'urn:uniffy:content:NOTE:note-001',
    contentType: 'NOTE',
    firstMentionedAt: '2026-03-22T08:03:00Z',
    lastMentionedAt: '2026-03-22T08:03:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-002',
  },
  {
    id: 'res-002',
    channelId: 'ch-001',
    urn: 'urn:uniffy:content:NOTE:note-003',
    contentType: 'NOTE',
    firstMentionedAt: '2026-03-18T11:00:00Z',
    lastMentionedAt: '2026-03-22T10:05:00Z',
    mentionCount: 3,
    firstMentionedBy: 'user-001',
  },

  // Files
  {
    id: 'res-003',
    channelId: 'ch-001',
    urn: 'urn:uniffy:content:FILE:file-002',
    contentType: 'FILE',
    firstMentionedAt: '2026-03-22T08:15:00Z',
    lastMentionedAt: '2026-03-22T08:15:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-004',
  },
  {
    id: 'res-004',
    channelId: 'ch-001',
    urn: 'urn:uniffy:content:FILE:file-003',
    contentType: 'FILE',
    firstMentionedAt: '2026-03-22T10:00:00Z',
    lastMentionedAt: '2026-03-22T10:00:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-004',
  },

  // Calendar event
  {
    id: 'res-005',
    channelId: 'ch-001',
    urn: 'urn:uniffy:content:CALENDAR_EVENT:event-001',
    contentType: 'CALENDAR_EVENT',
    firstMentionedAt: '2026-03-22T10:30:00Z',
    lastMentionedAt: '2026-03-22T10:30:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-002',
  },

  // ---------------------------------------------------------------
  // #engineering (ch-002) resources
  // ---------------------------------------------------------------

  // Notes
  {
    id: 'res-006',
    channelId: 'ch-002',
    urn: 'urn:uniffy:content:NOTE:note-002',
    contentType: 'NOTE',
    firstMentionedAt: '2026-03-21T14:08:00Z',
    lastMentionedAt: '2026-03-21T14:08:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-003',
  },

  // Files
  {
    id: 'res-007',
    channelId: 'ch-002',
    urn: 'urn:uniffy:content:FILE:file-004',
    contentType: 'FILE',
    firstMentionedAt: '2026-03-22T09:15:00Z',
    lastMentionedAt: '2026-03-22T09:15:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-005',
  },
  {
    id: 'res-008',
    channelId: 'ch-002',
    urn: 'urn:uniffy:content:FILE:file-005',
    contentType: 'FILE',
    firstMentionedAt: '2026-03-19T16:00:00Z',
    lastMentionedAt: '2026-03-20T10:30:00Z',
    mentionCount: 2,
    firstMentionedBy: 'user-008',
  },

  // Tasks
  {
    id: 'res-009',
    channelId: 'ch-002',
    urn: 'urn:uniffy:content:TASK:task-001',
    contentType: 'TASK',
    firstMentionedAt: '2026-03-22T08:30:00Z',
    lastMentionedAt: '2026-03-22T08:30:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-006',
  },
  {
    id: 'res-010',
    channelId: 'ch-002',
    urn: 'urn:uniffy:content:TASK:task-002',
    contentType: 'TASK',
    firstMentionedAt: '2026-03-21T16:30:00Z',
    lastMentionedAt: '2026-03-21T16:30:00Z',
    mentionCount: 1,
    firstMentionedBy: 'user-003',
  },
];

// Get all resources linked to a specific channel
export function getResourcesForChannel(channelId: string): ChatResource[] {
  return MOCK_RESOURCES.filter(r => r.channelId === channelId);
}
