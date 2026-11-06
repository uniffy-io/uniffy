import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { calendarApi } from "@/features/calendar/api/calendarApi";
import {
  getOrganizationId,
  refreshVisibleRange,
  timestampToIso,
} from "@/features/calendar/store/calendarThunks";
import type {
  CalendarEventDisposition,
  CalendarInfo,
  CalendarKind,
  CalendarPolicyAudience,
  CalendarPolicyInfo,
  CalendarSection,
  CalendarSubscriptionError,
  CalendarSubscriptionInfo,
  CalendarSubscriptionState,
} from "@/features/calendar/types";
import {
  CalendarEventDisposition as ProtoCalendarEventDisposition,
  CalendarListSection as ProtoCalendarListSection,
  CalendarPolicyAudience as ProtoCalendarPolicyAudience,
  CalendarSubscriptionError as ProtoSubscriptionError,
  CalendarSubscriptionState as ProtoSubscriptionState,
  CalendarType as ProtoCalendarType,
} from "@uniffy/proto/cal/v1/calendar_pb";
import type {
  Calendar as ProtoCalendar,
  CalendarPolicy as ProtoCalendarPolicy,
  CalendarSubscription as ProtoCalendarSubscription,
} from "@uniffy/proto/cal/v1/calendar_pb";

const KIND_FROM_PROTO: Record<number, CalendarKind> = {
  [ProtoCalendarType.PERSONAL]: "personal",
  [ProtoCalendarType.WORK]: "work",
  [ProtoCalendarType.TEAM]: "team",
  [ProtoCalendarType.SHARED]: "shared",
  [ProtoCalendarType.SUBSCRIBED]: "subscribed",
};

const KIND_TO_PROTO: Record<Exclude<CalendarKind, "subscribed">, ProtoCalendarType> = {
  personal: ProtoCalendarType.PERSONAL,
  work: ProtoCalendarType.WORK,
  team: ProtoCalendarType.TEAM,
  shared: ProtoCalendarType.SHARED,
};

const SECTION_FROM_PROTO: Record<number, CalendarSection> = {
  [ProtoCalendarListSection.MINE]: "mine",
  [ProtoCalendarListSection.SHARED]: "shared",
  [ProtoCalendarListSection.ORGANIZATION]: "organization",
  [ProtoCalendarListSection.SUBSCRIBED]: "subscribed",
};

const SUBSCRIPTION_STATE_FROM_PROTO: Record<number, CalendarSubscriptionState> = {
  [ProtoSubscriptionState.PENDING]: "pending",
  [ProtoSubscriptionState.HEALTHY]: "healthy",
  [ProtoSubscriptionState.FAILING]: "failing",
  [ProtoSubscriptionState.BROKEN]: "broken",
  [ProtoSubscriptionState.PAUSED]: "paused",
};

const SUBSCRIPTION_ERROR_FROM_PROTO: Record<number, CalendarSubscriptionError> = {
  [ProtoSubscriptionError.INVALID_URL]: "invalid_url",
  [ProtoSubscriptionError.UNRESOLVABLE]: "unresolvable",
  [ProtoSubscriptionError.BLOCKED_ADDRESS]: "blocked_address",
  [ProtoSubscriptionError.UNREACHABLE]: "unreachable",
  [ProtoSubscriptionError.TIMEOUT]: "timeout",
  [ProtoSubscriptionError.HTTP_STATUS]: "http_status",
  [ProtoSubscriptionError.TOO_LARGE]: "too_large",
  [ProtoSubscriptionError.REDIRECT_REFUSED]: "redirect_refused",
  [ProtoSubscriptionError.TOO_MANY_REDIRECTS]: "too_many_redirects",
  [ProtoSubscriptionError.NOT_A_CALENDAR]: "not_a_calendar",
  [ProtoSubscriptionError.TOO_MANY_EVENTS]: "too_many_events",
  [ProtoSubscriptionError.POLICY_DISABLED]: "policy_disabled",
  [ProtoSubscriptionError.UNPROCESSABLE]: "unprocessable",
};

const subscriptionFromProto = (proto: ProtoCalendarSubscription): CalendarSubscriptionInfo => ({
  urlHost: proto.urlHost,
  refreshIntervalMinutes: proto.refreshIntervalMinutes,
  countsAsBusy: proto.countsAsBusy,
  state: SUBSCRIPTION_STATE_FROM_PROTO[proto.state] ?? "pending",
  lastSuccessAt: proto.lastSuccessAt ? timestampToIso(proto.lastSuccessAt) : undefined,
  lastAttemptAt: proto.lastAttemptAt ? timestampToIso(proto.lastAttemptAt) : undefined,
  consecutiveFailures: proto.consecutiveFailures,
  lastError: SUBSCRIPTION_ERROR_FROM_PROTO[proto.lastError],
  lastErrorStatus: proto.lastErrorStatus,
  eventCount: proto.eventCount,
  skippedCount: proto.skippedCount,
});

const AUDIENCE_FROM_PROTO: Record<number, CalendarPolicyAudience> = {
  [ProtoCalendarPolicyAudience.EVERYONE]: "everyone",
  [ProtoCalendarPolicyAudience.ADMINS]: "admins",
};

const AUDIENCE_TO_PROTO: Record<CalendarPolicyAudience, ProtoCalendarPolicyAudience> = {
  everyone: ProtoCalendarPolicyAudience.EVERYONE,
  admins: ProtoCalendarPolicyAudience.ADMINS,
};

export const calendarFromProto = (proto: ProtoCalendar): CalendarInfo => ({
  id: proto.id,
  organizationId: proto.organizationId,
  ownerId: proto.ownerId,
  ownerName: proto.ownerName,
  name: proto.name,
  description: proto.description,
  color: proto.color,
  kind: KIND_FROM_PROTO[proto.calendarType] ?? "personal",
  isDefault: proto.isDefault,
  accessMode: proto.accessMode,
  baselineRole: proto.baselineRole,
  userRole: proto.userRole,
  isHidden: proto.isHidden,
  section: SECTION_FROM_PROTO[proto.section] ?? "mine",
  isReadOnly: proto.isReadOnly,
  subscription: proto.subscription ? subscriptionFromProto(proto.subscription) : undefined,
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
});

const policyFromProto = (response: {
  policy?: ProtoCalendarPolicy;
  canCreateTeamCalendars: boolean;
  canShareCalendarsOrgWide: boolean;
  canSubscribeExternalCalendars: boolean;
}): CalendarPolicyInfo => ({
  teamCalendarCreators:
    AUDIENCE_FROM_PROTO[response.policy?.teamCalendarCreators ?? 0] ?? "everyone",
  orgWideCalendarSharers:
    AUDIENCE_FROM_PROTO[response.policy?.orgWideCalendarSharers ?? 0] ?? "everyone",
  allowExternalSubscriptions: response.policy?.allowExternalSubscriptions ?? false,
  canCreateTeamCalendars: response.canCreateTeamCalendars,
  canShareCalendarsOrgWide: response.canShareCalendarsOrgWide,
  canSubscribeExternalCalendars: response.canSubscribeExternalCalendars,
});

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const fetchCalendars = createAsyncThunk<
  CalendarInfo[],
  void,
  { state: RootState; rejectValue: string }
>("calendar/fetchCalendars", async (_, { getState, rejectWithValue, signal }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const calendars: CalendarInfo[] = [];
    let pageToken = "";
    do {
      signal.throwIfAborted();
      const response = await calendarApi.listCalendars({ organizationId, pageToken });
      calendars.push(...response.calendars.map(calendarFromProto));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return calendars;
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load calendars"));
  }
});

export const createCalendar = createAsyncThunk<
  CalendarInfo,
  {
    name: string;
    color: string;
    description?: string;
    kind: Exclude<CalendarKind, "subscribed">;
    adminUserIds?: string[];
    adminGroupIds?: string[];
  },
  { state: RootState; rejectValue: string }
>("calendar/createCalendar", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.createCalendar({
      organizationId,
      name: params.name,
      color: params.color,
      description: params.description,
      calendarType: KIND_TO_PROTO[params.kind],
      adminUserIds: params.adminUserIds ?? [],
      adminGroupIds: params.adminGroupIds ?? [],
    });
    if (!response.calendar) return rejectWithValue("Failed to create calendar");
    return calendarFromProto(response.calendar);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to create calendar"));
  }
});

export const updateCalendar = createAsyncThunk<
  CalendarInfo,
  { calendarId: string; name?: string; description?: string; color?: string },
  { state: RootState; rejectValue: string }
>("calendar/updateCalendar", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.updateCalendar({ organizationId, ...params });
    if (!response.calendar) return rejectWithValue("Failed to update calendar");
    return calendarFromProto(response.calendar);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to update calendar"));
  }
});

export const deleteCalendar = createAsyncThunk<
  { calendarId: string; eventsMoved: number; eventsDeleted: number },
  { calendarId: string; disposition: CalendarEventDisposition; targetCalendarId?: string },
  { state: RootState; rejectValue: string; dispatch: AppDispatch }
>("calendar/deleteCalendar", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.deleteCalendar({
      organizationId,
      calendarId: params.calendarId,
      disposition:
        params.disposition === "move"
          ? ProtoCalendarEventDisposition.MOVE
          : ProtoCalendarEventDisposition.DELETE,
      targetCalendarId: params.disposition === "move" ? params.targetCalendarId : undefined,
    });
    await refreshVisibleRange(getState(), dispatch);
    return {
      calendarId: params.calendarId,
      eventsMoved: response.eventsMoved,
      eventsDeleted: response.eventsDeleted,
    };
  } catch (error) {
    return rejectWithValue(message(error, "Failed to delete calendar"));
  }
});

const visibilityWrites = new Map<string, Promise<unknown>>();

export const setCalendarVisibility = createAsyncThunk<
  CalendarInfo,
  { calendarId: string; hidden: boolean },
  { state: RootState; rejectValue: string; dispatch: AppDispatch }
>(
  "calendar/setCalendarVisibility",
  async (params, { getState, rejectWithValue, dispatch, signal }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const key = `${getState().auth.user?.id}:${organizationId}:${params.calendarId}`;
      const write = async () => {
        signal.throwIfAborted();
        return calendarApi.setCalendarVisibility({ organizationId, ...params });
      };
      const pending = (visibilityWrites.get(key) ?? Promise.resolve()).then(write, write);
      visibilityWrites.set(key, pending);
      let response;
      try {
        response = await pending;
      } finally {
        if (visibilityWrites.get(key) === pending) visibilityWrites.delete(key);
      }
      signal.throwIfAborted();
      if (!response.calendar) return rejectWithValue("Failed to change calendar visibility");
      // The server decides which events a hidden calendar removes, invitations included.
      await refreshVisibleRange(getState(), dispatch);
      return calendarFromProto(response.calendar);
    } catch (error) {
      return rejectWithValue(message(error, "Failed to change calendar visibility"));
    }
  },
);

/** Event count shown before a delete, so the member knows what the choice covers. */
export const countCalendarEvents = createAsyncThunk<
  number,
  string,
  { state: RootState; rejectValue: string }
>("calendar/countCalendarEvents", async (calendarId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.getCalendar({ organizationId, calendarId });
    return response.eventSeriesCount;
  } catch (error) {
    return rejectWithValue(message(error, "Failed to count events"));
  }
});

export const fetchCalendarPolicy = createAsyncThunk<
  CalendarPolicyInfo,
  void,
  { state: RootState; rejectValue: string }
>("calendar/fetchCalendarPolicy", async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.getCalendarPolicy({ organizationId });
    return policyFromProto(response);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load calendar policy"));
  }
});

export const updateCalendarPolicy = createAsyncThunk<
  CalendarPolicyInfo,
  {
    teamCalendarCreators: CalendarPolicyAudience;
    orgWideCalendarSharers: CalendarPolicyAudience;
    allowExternalSubscriptions?: boolean;
  },
  { state: RootState; rejectValue: string }
>("calendar/updateCalendarPolicy", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.updateCalendarPolicy({
      organizationId,
      teamCalendarCreators: AUDIENCE_TO_PROTO[params.teamCalendarCreators],
      orgWideCalendarSharers: AUDIENCE_TO_PROTO[params.orgWideCalendarSharers],
      allowExternalSubscriptions: params.allowExternalSubscriptions,
    });
    return policyFromProto(response);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to save calendar policy"));
  }
});

export interface SubscriptionSettings {
  refreshIntervalMinutes: number;
  countsAsBusy: boolean;
}

/** Why a new address could not be read; nothing was saved. */
export interface FeedCheckError {
  error?: CalendarSubscriptionError;
  status: number;
}

/** A saved subscription, or the reason its address was refused before anything was saved. */
export interface SubscriptionSaved {
  calendar?: CalendarInfo;
  checkError?: FeedCheckError;
}

const checkErrorFromProto = (
  error: ProtoSubscriptionError,
  status: number,
): FeedCheckError | undefined =>
  error === ProtoSubscriptionError.UNSPECIFIED
    ? undefined
    : { error: SUBSCRIPTION_ERROR_FROM_PROTO[error], status };

export const createCalendarSubscription = createAsyncThunk<
  SubscriptionSaved,
  SubscriptionSettings & { url: string; name: string; color: string },
  { state: RootState; rejectValue: string }
>("calendar/createCalendarSubscription", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.createCalendarSubscription({ organizationId, ...params });
    const checkError = checkErrorFromProto(response.checkError, response.checkErrorStatus);
    if (checkError) return { checkError };
    if (!response.calendar) return rejectWithValue("Failed to subscribe to the calendar");
    return { calendar: calendarFromProto(response.calendar) };
  } catch (error) {
    return rejectWithValue(message(error, "Failed to subscribe to the calendar"));
  }
});

export const updateCalendarSubscription = createAsyncThunk<
  SubscriptionSaved,
  Partial<SubscriptionSettings> & { calendarId: string; url?: string },
  { state: RootState; rejectValue: string; dispatch: AppDispatch }
>(
  "calendar/updateCalendarSubscription",
  async (params, { getState, rejectWithValue, dispatch }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await calendarApi.updateCalendarSubscription({ organizationId, ...params });
      if (!response.calendar) return rejectWithValue("Failed to update the subscription");
      const calendar = calendarFromProto(response.calendar);
      const checkError = checkErrorFromProto(response.checkError, response.checkErrorStatus);
      if (checkError) return { calendar, checkError };
      // Counting as busy changes what scheduling sees, not the grid; a new address
      // refreshes in the background and its events arrive with the next change signal.
      if (params.countsAsBusy !== undefined) await refreshVisibleRange(getState(), dispatch);
      return { calendar };
    } catch (error) {
      return rejectWithValue(message(error, "Failed to update the subscription"));
    }
  },
);

export const refreshCalendarSubscription = createAsyncThunk<
  CalendarInfo,
  string,
  { state: RootState; rejectValue: string }
>("calendar/refreshCalendarSubscription", async (calendarId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.refreshCalendarSubscription({ organizationId, calendarId });
    if (!response.calendar) return rejectWithValue("Failed to refresh the calendar");
    return calendarFromProto(response.calendar);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to refresh the calendar"));
  }
});
