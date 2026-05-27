export type AttendeeStatus =
  | 'pending'
  | 'accepted'
  | 'tentative'
  | 'declined';

export type AttendeeRole =
  | 'organizer'
  | 'required'
  | 'optional';

export interface Attendee {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  initials: string;
  status: AttendeeStatus;
  role: AttendeeRole;
  timezone?: string;
}

export interface AttendeeSuggestion {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  initials: string;
  isRecent?: boolean;
  isOrganization?: boolean;
}

export interface AvatarStackConfig {
  maxVisible: number;
  size: number;
  overlap: number;
}

export const ATTENDEE_STATUS_CONFIG: Record<AttendeeStatus, { icon: string; color: string; label: string }> = {
  pending: {
    icon: '○',
    color: '#94a3b8',
    label: 'No response',
  },
  accepted: {
    icon: '✓',
    color: '#10B981',
    label: 'Accepted',
  },
  tentative: {
    icon: '⏳',
    color: '#F59E0B',
    label: 'Tentative',
  },
  declined: {
    icon: '✗',
    color: '#EF4444',
    label: 'Declined',
  },
};
