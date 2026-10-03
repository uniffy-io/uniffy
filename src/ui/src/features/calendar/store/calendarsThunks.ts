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
} from "@/features/calendar/types";
import {
  CalendarEventDisposition as ProtoCalendarEventDisposition,
  CalendarListSection as ProtoCalendarListSection,
  CalendarPolicyAudience as ProtoCalendarPolicyAudience,
  CalendarType as ProtoCalendarType,
} from "@uniffy/proto/cal/v1/calendar_pb";
import type {
  Calendar as ProtoCalendar,
  CalendarPolicy as ProtoCalendarPolicy,
} from "@uniffy/proto/cal/v1/calendar_pb";

const KIND_FROM_PROTO: Record<number, CalendarKind> = {
  [ProtoCalendarType.PERSONAL]: "personal",
  [ProtoCalendarType.WORK]: "work",
  [ProtoCalendarType.TEAM]: "team",
  [ProtoCalendarType.SHARED]: "shared",
};

const KIND_TO_PROTO: Record<CalendarKind, ProtoCalendarType> = {
  personal: ProtoCalendarType.PERSONAL,
  work: ProtoCalendarType.WORK,
  team: ProtoCalendarType.TEAM,
  shared: ProtoCalendarType.SHARED,
};

const SECTION_FROM_PROTO: Record<number, CalendarSection> = {
  [ProtoCalendarListSection.MINE]: "mine",
  [ProtoCalendarListSection.SHARED]: "shared",
  [ProtoCalendarListSection.ORGANIZATION]: "organization",
};

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
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
});

const policyFromProto = (
  policy: ProtoCalendarPolicy | undefined,
  canCreateTeamCalendars: boolean,
  canShareCalendarsOrgWide: boolean,
): CalendarPolicyInfo => ({
  teamCalendarCreators: AUDIENCE_FROM_PROTO[policy?.teamCalendarCreators ?? 0] ?? "everyone",
  orgWideCalendarSharers: AUDIENCE_FROM_PROTO[policy?.orgWideCalendarSharers ?? 0] ?? "everyone",
  canCreateTeamCalendars,
  canShareCalendarsOrgWide,
});

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const fetchCalendars = createAsyncThunk<
  CalendarInfo[],
  void,
  { state: RootState; rejectValue: string }
>("calendar/fetchCalendars", async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listCalendars({ organizationId });
    return response.calendars.map(calendarFromProto);
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
    kind: CalendarKind;
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

export const setCalendarVisibility = createAsyncThunk<
  CalendarInfo,
  { calendarId: string; hidden: boolean },
  { state: RootState; rejectValue: string; dispatch: AppDispatch }
>("calendar/setCalendarVisibility", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.setCalendarVisibility({ organizationId, ...params });
    if (!response.calendar) return rejectWithValue("Failed to change calendar visibility");
    // The server decides which events a hidden calendar removes, invitations included.
    await refreshVisibleRange(getState(), dispatch);
    return calendarFromProto(response.calendar);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to change calendar visibility"));
  }
});

/** Event count shown before a delete, so the member knows what the choice covers. */
export const countCalendarEvents = createAsyncThunk<
  number,
  string,
  { state: RootState; rejectValue: string }
>("calendar/countCalendarEvents", async (calendarId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listEvents({
      organizationId,
      calendarId,
      page: 1,
      pageSize: 1,
    });
    return response.totalCount;
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
    return policyFromProto(
      response.policy,
      response.canCreateTeamCalendars,
      response.canShareCalendarsOrgWide,
    );
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load calendar policy"));
  }
});

export const updateCalendarPolicy = createAsyncThunk<
  CalendarPolicyInfo,
  { teamCalendarCreators: CalendarPolicyAudience; orgWideCalendarSharers: CalendarPolicyAudience },
  { state: RootState; rejectValue: string }
>("calendar/updateCalendarPolicy", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.updateCalendarPolicy({
      organizationId,
      teamCalendarCreators: AUDIENCE_TO_PROTO[params.teamCalendarCreators],
      orgWideCalendarSharers: AUDIENCE_TO_PROTO[params.orgWideCalendarSharers],
    });
    return policyFromProto(
      response.policy,
      response.canCreateTeamCalendars,
      response.canShareCalendarsOrgWide,
    );
  } catch (error) {
    return rejectWithValue(message(error, "Failed to save calendar policy"));
  }
});
