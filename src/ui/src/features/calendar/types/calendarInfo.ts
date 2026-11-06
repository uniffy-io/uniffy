export type CalendarKind = "personal" | "work" | "team" | "shared" | "subscribed";

/** Where a calendar sits in the member's list; server-assigned. */
export type CalendarSection = "mine" | "shared" | "organization" | "subscribed";

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
  /** Events on it come from an external feed and cannot be created or changed here. */
  isReadOnly: boolean;
  /** The feed behind a subscribed calendar; present for its owner only. */
  subscription?: CalendarSubscriptionInfo;
  createdAt: string;
  updatedAt: string;
}

export type CalendarSubscriptionState = "pending" | "healthy" | "failing" | "broken" | "paused";

export type CalendarSubscriptionError =
  | "invalid_url"
  | "unresolvable"
  | "blocked_address"
  | "unreachable"
  | "timeout"
  | "http_status"
  | "too_large"
  | "redirect_refused"
  | "too_many_redirects"
  | "not_a_calendar"
  | "too_many_events"
  | "policy_disabled"
  | "unprocessable";

export interface CalendarSubscriptionInfo {
  /** The feed's host; the address itself is a secret the server never returns. */
  urlHost: string;
  refreshIntervalMinutes: number;
  countsAsBusy: boolean;
  state: CalendarSubscriptionState;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  consecutiveFailures: number;
  lastError?: CalendarSubscriptionError;
  /** The HTTP status behind an `http_status` error. */
  lastErrorStatus: number;
  eventCount: number;
  skippedCount: number;
}

export interface CalendarPolicyInfo {
  teamCalendarCreators: CalendarPolicyAudience;
  orgWideCalendarSharers: CalendarPolicyAudience;
  /** What the policy allows the member reading it. */
  canCreateTeamCalendars: boolean;
  canShareCalendarsOrgWide: boolean;
  allowExternalSubscriptions: boolean;
  canSubscribeExternalCalendars: boolean;
}
