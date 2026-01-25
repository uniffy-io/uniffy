/**
 * Attendee type definitions
 */

/**
 * Attendee response status
 */
export type AttendeeStatus =
  | 'pending'      // No response yet
  | 'accepted'     // Confirmed attendance
  | 'tentative'    // Maybe attending
  | 'declined';    // Not attending

/**
 * Attendee role in the event
 */
export type AttendeeRole =
  | 'organizer'    // Event creator
  | 'required'     // Must attend
  | 'optional';    // Optional attendance

/**
 * Event attendee
 */
export interface Attendee {
  /** User ID */
  id: string;
  /** Display name */
  name: string;
  /** Email address */
  email: string;
  /** Avatar URL or initials color */
  avatarUrl?: string;
  /** Initials for avatar fallback */
  initials: string;
  /** Response status */
  status: AttendeeStatus;
  /** Role in the event */
  role: AttendeeRole;
  /** Timezone for display */
  timezone?: string;
}

/**
 * Attendee suggestion for autocomplete
 */
export interface AttendeeSuggestion {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  initials: string;
  /** Indicates if this is a recent/frequent contact */
  isRecent?: boolean;
  /** Indicates if this is in the same organization */
  isOrganization?: boolean;
}

/**
 * Avatar stack configuration
 */
export interface AvatarStackConfig {
  /** Maximum avatars to show before "+N" */
  maxVisible: number;
  /** Avatar size in pixels */
  size: number;
  /** Overlap amount in pixels */
  overlap: number;
}

/**
 * Get status icon and color for attendee status
 */
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
