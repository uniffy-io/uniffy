import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { calendarApi } from "@/features/calendar/api/calendarApi";
import {
  getOrganizationId,
  refreshVisibleRange,
  timestampToIso,
} from "@/features/calendar/store/calendarThunks";
import {
  DELEGATION_LEVEL_FROM_PROTO,
  DELEGATION_LEVEL_TO_PROTO,
  KIND_FROM_PROTO,
  fetchCalendars,
  message,
} from "@/features/calendar/store/calendarsThunks";
import type {
  CalendarDelegationInfo,
  CalendarDelegationLevel,
  SharedCalendarSummaryInfo,
} from "@/features/calendar/types";
import type {
  CalendarDelegation as ProtoCalendarDelegation,
  SharedCalendarSummary as ProtoSharedCalendarSummary,
} from "@uniffy/proto/cal/v1/calendar_pb";

export const delegationFromProto = (proto: ProtoCalendarDelegation): CalendarDelegationInfo => ({
  id: proto.id,
  grantorId: proto.grantorId,
  grantorName: proto.grantorName,
  delegateId: proto.delegateId,
  delegateName: proto.delegateName,
  level: DELEGATION_LEVEL_FROM_PROTO[proto.level] ?? "events",
  createdAt: timestampToIso(proto.createdAt),
  inactive: proto.inactive,
});

const summaryFromProto = (proto: ProtoSharedCalendarSummary): SharedCalendarSummaryInfo => ({
  calendarId: proto.calendarId,
  name: proto.name,
  ownerId: proto.ownerId,
  ownerName: proto.ownerName,
  kind: KIND_FROM_PROTO[proto.calendarType] ?? "personal",
  accessMode: proto.accessMode,
  baselineRole: proto.baselineRole,
  userGrantCount: proto.userGrantCount,
  groupGrantCount: proto.groupGrantCount,
  createdAt: timestampToIso(proto.createdAt),
});

export interface MyDelegations {
  grantedByMe: CalendarDelegationInfo[];
  grantedToMe: CalendarDelegationInfo[];
}

export const fetchMyDelegations = createAsyncThunk<
  MyDelegations,
  void,
  { state: RootState; rejectValue: string }
>("calendar/fetchMyDelegations", async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listMyCalendarDelegations({ organizationId });
    return {
      grantedByMe: response.grantedByMe.map(delegationFromProto),
      grantedToMe: response.grantedToMe.map(delegationFromProto),
    };
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load delegates"));
  }
});

export const grantDelegation = createAsyncThunk<
  CalendarDelegationInfo,
  { delegateId: string; level: CalendarDelegationLevel },
  { state: RootState; rejectValue: string }
>("calendar/grantDelegation", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.grantCalendarDelegation({
      organizationId,
      delegateId: params.delegateId,
      level: DELEGATION_LEVEL_TO_PROTO[params.level],
    });
    if (!response.delegation) return rejectWithValue("Failed to save the delegate");
    return delegationFromProto(response.delegation);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to save the delegate"));
  }
});

export const revokeDelegation = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string; dispatch: AppDispatch }
>("calendar/revokeDelegation", async (delegationId, { getState, rejectWithValue, dispatch }) => {
  try {
    const state = getState();
    const organizationId = getOrganizationId(state);
    await calendarApi.revokeCalendarDelegation({ organizationId, delegationId });
    // A delegate stepping down loses the grantor's calendar from their own view.
    if (state.calendar.delegationsToMe.some((delegation) => delegation.id === delegationId)) {
      await dispatch(fetchCalendars());
      await refreshVisibleRange(getState(), dispatch);
    }
    return delegationId;
  } catch (error) {
    return rejectWithValue(message(error, "Failed to remove the delegate"));
  }
});

export interface DelegationPage {
  items: CalendarDelegationInfo[];
  nextPageToken: string;
}

export const fetchOrgDelegations = createAsyncThunk<
  DelegationPage,
  { pageToken?: string; userId?: string },
  { state: RootState; rejectValue: string }
>("calendar/fetchOrgDelegations", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listOrgCalendarDelegations({
      organizationId,
      userId: params.userId,
      pageToken: params.pageToken ?? "",
    });
    return {
      items: response.delegations.map(delegationFromProto),
      nextPageToken: response.nextPageToken,
    };
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load delegations"));
  }
});

export const adminRevokeDelegation = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("calendar/adminRevokeDelegation", async (delegationId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await calendarApi.adminRevokeCalendarDelegation({ organizationId, delegationId });
    return delegationId;
  } catch (error) {
    return rejectWithValue(message(error, "Failed to revoke the delegation"));
  }
});

export interface SharedCalendarPage {
  items: SharedCalendarSummaryInfo[];
  nextPageToken: string;
}

export const fetchSharedCalendars = createAsyncThunk<
  SharedCalendarPage,
  { pageToken?: string },
  { state: RootState; rejectValue: string }
>("calendar/fetchSharedCalendars", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listOrgSharedCalendars({
      organizationId,
      pageToken: params.pageToken ?? "",
    });
    return {
      items: response.calendars.map(summaryFromProto),
      nextPageToken: response.nextPageToken,
    };
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load shared calendars"));
  }
});

export const restrictCalendarToMembers = createAsyncThunk<
  SharedCalendarSummaryInfo,
  string,
  { state: RootState; rejectValue: string }
>("calendar/restrictCalendarToMembers", async (calendarId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.restrictCalendarToMembers({ organizationId, calendarId });
    if (!response.calendar) return rejectWithValue("Failed to restrict the calendar");
    return summaryFromProto(response.calendar);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to restrict the calendar"));
  }
});
