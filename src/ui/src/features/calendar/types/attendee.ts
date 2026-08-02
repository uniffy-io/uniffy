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

