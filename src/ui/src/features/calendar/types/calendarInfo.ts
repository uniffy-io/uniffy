export type CalendarKind = "personal" | "work" | "team" | "shared";

/** Where a calendar sits in the member's list; server-assigned. */
export type CalendarSection = "mine" | "shared" | "delegated" | "organization";

/** `events` keeps private events busy-only; `events_and_private` reveals them too. */
export type CalendarDelegationLevel = "events" | "events_and_private";

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
  /** Set when the member reaches this calendar as the owner's delegate. */
  delegationLevel?: CalendarDelegationLevel;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarPolicyInfo {
  teamCalendarCreators: CalendarPolicyAudience;
  orgWideCalendarSharers: CalendarPolicyAudience;
  delegators: CalendarPolicyAudience;
  /** What the policy allows the member reading it. */
  canCreateTeamCalendars: boolean;
  canShareCalendarsOrgWide: boolean;
  canDelegate: boolean;
}

export interface CalendarDelegationInfo {
  id: string;
  grantorId: string;
  grantorName: string;
  delegateId: string;
  delegateName: string;
  level: CalendarDelegationLevel;
  createdAt: string;
  /** Either party is deactivated; the grant confers nothing meanwhile. */
  inactive: boolean;
}

/** A shared calendar as an org admin sees it: who it reaches, never what is on it. */
export interface SharedCalendarSummaryInfo {
  calendarId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  kind: CalendarKind;
  /** Effective `AccessMode` from common.v1. */
  accessMode: number;
  baselineRole?: number;
  userGrantCount: number;
  groupGrantCount: number;
  createdAt: string;
}
