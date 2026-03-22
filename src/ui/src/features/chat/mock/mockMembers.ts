import { type ChatChannelMember } from '@/features/chat/mock/types';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';

// Mock user data (matches User model shape from SubjectAvatar needs)
export interface MockUser {
  id: string;
  email: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
}

export const CURRENT_USER_ID = 'user-001';

export const MOCK_USERS: MockUser[] = [
  { id: 'user-001', email: 'alex.chen@uniffy.io', fullName: 'Alex Chen', username: 'alexchen', avatarUrl: null },
  { id: 'user-002', email: 'sarah.miller@uniffy.io', fullName: 'Sarah Miller', username: 'sarahmiller', avatarUrl: null },
  { id: 'user-003', email: 'james.wilson@uniffy.io', fullName: 'James Wilson', username: 'jameswilson', avatarUrl: null },
  { id: 'user-004', email: 'emma.davis@uniffy.io', fullName: 'Emma Davis', username: 'emmadavis', avatarUrl: null },
  { id: 'user-005', email: 'michael.brown@uniffy.io', fullName: 'Michael Brown', username: 'michaelbrown', avatarUrl: null },
  { id: 'user-006', email: 'olivia.garcia@uniffy.io', fullName: 'Olivia Garcia', username: 'oliviagarcia', avatarUrl: null },
  { id: 'user-007', email: 'daniel.martinez@uniffy.io', fullName: 'Daniel Martinez', username: 'danielmartinez', avatarUrl: null },
  { id: 'user-008', email: 'sophia.anderson@uniffy.io', fullName: 'Sophia Anderson', username: 'sophiaanderson', avatarUrl: null },
];

// Helper to find user by ID
export function getMockUser(userId: string): MockUser | undefined {
  return MOCK_USERS.find(u => u.id === userId);
}

// Convert a mock user to a Subject for SubjectAvatar
export function toSubject(userId: string): Subject {
  const user = getMockUser(userId);
  return {
    id: userId,
    type: SUBJECT_TYPE.USER,
    name: user?.fullName ?? 'Unknown User',
    email: user?.email,
    avatarUrl: user?.avatarUrl ?? undefined,
  };
}

// Channel memberships keyed by channel ID
export const MOCK_CHANNEL_MEMBERS: Record<string, ChatChannelMember[]> = {
  // #general - all 8 members
  'ch-001': [
    { channelId: 'ch-001', userId: 'user-001', role: 'OWNER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:00:00Z' },
    { channelId: 'ch-001', userId: 'user-002', role: 'ADMIN', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:00:00Z' },
    { channelId: 'ch-001', userId: 'user-003', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:05:00Z' },
    { channelId: 'ch-001', userId: 'user-004', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-10T09:05:00Z' },
    { channelId: 'ch-001', userId: 'user-005', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-11T10:00:00Z' },
    { channelId: 'ch-001', userId: 'user-006', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-11T10:00:00Z' },
    { channelId: 'ch-001', userId: 'user-007', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-12T08:30:00Z' },
    { channelId: 'ch-001', userId: 'user-008', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-12T08:30:00Z' },
  ],

  // #engineering - 6 members
  'ch-002': [
    { channelId: 'ch-002', userId: 'user-001', role: 'OWNER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:00:00Z' },
    { channelId: 'ch-002', userId: 'user-003', role: 'ADMIN', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:00:00Z' },
    { channelId: 'ch-002', userId: 'user-005', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:10:00Z' },
    { channelId: 'ch-002', userId: 'user-006', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-11T11:00:00Z' },
    { channelId: 'ch-002', userId: 'user-007', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-11T11:00:00Z' },
    { channelId: 'ch-002', userId: 'user-008', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-12T14:00:00Z' },
  ],

  // #design - 4 members
  'ch-003': [
    { channelId: 'ch-003', userId: 'user-004', role: 'OWNER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-15T10:00:00Z' },
    { channelId: 'ch-003', userId: 'user-002', role: 'ADMIN', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-15T10:00:00Z' },
    { channelId: 'ch-003', userId: 'user-006', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-15T10:30:00Z' },
    { channelId: 'ch-003', userId: 'user-008', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-16T09:00:00Z' },
  ],

  // #random - 7 members
  'ch-004': [
    { channelId: 'ch-004', userId: 'user-002', role: 'OWNER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-10T09:00:00Z' },
    { channelId: 'ch-004', userId: 'user-001', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-10T09:00:00Z' },
    { channelId: 'ch-004', userId: 'user-003', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: true, joinedAt: '2026-01-10T09:05:00Z' },
    { channelId: 'ch-004', userId: 'user-004', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-10T09:05:00Z' },
    { channelId: 'ch-004', userId: 'user-005', role: 'MEMBER', notificationLevel: 'NONE', isMuted: true, joinedAt: '2026-01-11T10:00:00Z' },
    { channelId: 'ch-004', userId: 'user-006', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-01-11T10:00:00Z' },
    { channelId: 'ch-004', userId: 'user-007', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-12T08:30:00Z' },
  ],

  // #secret-project - 3 members
  'ch-005': [
    { channelId: 'ch-005', userId: 'user-001', role: 'OWNER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-02-01T10:00:00Z' },
    { channelId: 'ch-005', userId: 'user-003', role: 'ADMIN', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-02-01T10:00:00Z' },
    { channelId: 'ch-005', userId: 'user-005', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-02-01T10:30:00Z' },
  ],

  // #leadership - 2 members
  'ch-006': [
    { channelId: 'ch-006', userId: 'user-001', role: 'OWNER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-20T09:00:00Z' },
    { channelId: 'ch-006', userId: 'user-002', role: 'ADMIN', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-20T09:00:00Z' },
  ],

  // DM with Sarah Miller
  'ch-007': [
    { channelId: 'ch-007', userId: 'user-001', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-14T11:00:00Z' },
    { channelId: 'ch-007', userId: 'user-002', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-01-14T11:00:00Z' },
  ],

  // DM with James Wilson
  'ch-008': [
    { channelId: 'ch-008', userId: 'user-001', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-02-03T15:00:00Z' },
    { channelId: 'ch-008', userId: 'user-003', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-02-03T15:00:00Z' },
  ],

  // Group DM (Alex, Emma, Michael, Olivia)
  'ch-009': [
    { channelId: 'ch-009', userId: 'user-001', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-03-01T09:00:00Z' },
    { channelId: 'ch-009', userId: 'user-004', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-03-01T09:00:00Z' },
    { channelId: 'ch-009', userId: 'user-005', role: 'MEMBER', notificationLevel: 'ALL', isMuted: false, joinedAt: '2026-03-01T09:00:00Z' },
    { channelId: 'ch-009', userId: 'user-006', role: 'MEMBER', notificationLevel: 'MENTIONS', isMuted: false, joinedAt: '2026-03-01T09:00:00Z' },
  ],
};
