export type CalendarKind = "personal" | "work" | "team" | "shared";

/** Where a calendar sits in the member's list; server-assigned. */
export type CalendarSection = "mine" | "shared" | "organization";

export type CalendarEventDisposition = "move" | "delete";

export type CalendarPolicyAudience = "everyone" | "admins";

export interface CalendarInfo {
  id: string;
  organizationId: string;
  ownerId: string;
  /** The owner's display name; see `calendarLabel`. */
  ownerName: string;
  name: string;
  description: string;
  /** Hex. */
  color: string;
  kind: CalendarKind;
  isDefault: boolean;
  /** `AccessMode` from common.v1. */
  accessMode: number;
  /** `ContentRole` from common.v1; undefined inherits the org default. */
  baselineRole?: number;
  /** Caller's effective `ContentRole`; 0 when the server resolved none. */
  userRole: number;
  /** Hidden for this member only. */
  isHidden: boolean;
  section: CalendarSection;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarPolicyInfo {
  teamCalendarCreators: CalendarPolicyAudience;
  orgWideCalendarSharers: CalendarPolicyAudience;
  /** What the policy allows the member reading it. */
  canCreateTeamCalendars: boolean;
  canShareCalendarsOrgWide: boolean;
}
