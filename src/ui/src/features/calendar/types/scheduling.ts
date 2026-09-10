export interface SchedulingBusyInterval {
  /** ISO instants */
  start: string;
  end: string;
  isOutOfOffice: boolean;
}

export interface UserFreeBusy {
  userId: string;
  intervals: SchedulingBusyInterval[];
  /** IANA zone the workday bounds below are expressed in */
  timezone: string;
  workdayStart: string;
  workdayEnd: string;
  workdays: string[];
}

export interface FreeBusyData {
  users: UserFreeBusy[];
  roomBusy: SchedulingBusyInterval[];
}

export interface MeetingSuggestion {
  start: string;
  end: string;
  unavailableOptionalUserIds: string[];
}

/**
 * Mirrors MAX_FREE_BUSY_USERS in the calendar availability domain; past it the
 * panel degrades instead of querying. Keep the two in step.
 */
export const MAX_FREE_BUSY_USERS = 100;
