import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { connectionsApi } from "@/features/calendar/api/connectionsApi";
import { getOrganizationId, refreshVisibleRange } from "@/features/calendar/store/calendarThunks";
import { fetchCalendars } from "@/features/calendar/store/calendarsThunks";
import {
  availabilityFromProto,
  connectionFromProto,
  DIRECTION_TO_PROTO,
  PROVIDER_TO_PROTO,
  providerSettingsFromProto,
} from "@/features/calendar/store/connectionConverters";
import type {
  CalendarConnectionInfo,
  CalendarProviderId,
  CalendarSyncDirection,
  ProviderAvailabilityInfo,
  ProviderSettingsInfo,
} from "@/features/calendar/types/connections";
import type { CalendarConnection as ProtoConnection } from "@uniffy/proto/cal/v1/connections_pb";

type ThunkConfig = { state: RootState; rejectValue: string; dispatch: AppDispatch };

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const requireConnection = (proto: ProtoConnection | undefined): CalendarConnectionInfo => {
  if (!proto) throw new Error("The calendar account could not be loaded");
  return connectionFromProto(proto);
};

export interface ConnectionsListed {
  connections: CalendarConnectionInfo[];
  providers: ProviderAvailabilityInfo[];
  canConnect: boolean;
}

export const fetchCalendarConnections = createAsyncThunk<ConnectionsListed, void, ThunkConfig>(
  "calendarConnections/list",
  async (_, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await connectionsApi.listCalendarConnections({ organizationId });
      return {
        connections: response.connections.map(connectionFromProto),
        providers: availabilityFromProto(response.providers),
        canConnect: response.canConnect,
      };
    } catch (error) {
      return rejectWithValue(message(error, "Failed to load connected calendars"));
    }
  },
);

/** Returns the provider's sign-in address; the caller leaves the app for it. */
export const startCalendarConnection = createAsyncThunk<
  string,
  { provider: CalendarProviderId; returnPath: string; reconnectConnectionId?: string },
  ThunkConfig
>("calendarConnections/start", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await connectionsApi.startCalendarConnection({
      organizationId,
      provider: PROVIDER_TO_PROTO[params.provider],
      returnPath: params.returnPath,
      reconnectConnectionId: params.reconnectConnectionId,
    });
    if (!response.authorizeUrl) return rejectWithValue("Failed to start the sign-in");
    return response.authorizeUrl;
  } catch (error) {
    return rejectWithValue(message(error, "Failed to start the sign-in"));
  }
});

export const completeCalendarConnection = createAsyncThunk<
  { connection: CalendarConnectionInfo; returnPath: string },
  { code: string; state: string; error: string; errorDescription: string },
  ThunkConfig
>("calendarConnections/complete", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await connectionsApi.completeCalendarConnection({
      organizationId,
      code: params.code,
      state: params.state,
      error: params.error,
      errorDescription: params.errorDescription,
    });
    return {
      connection: requireConnection(response.connection),
      returnPath: response.returnPath,
    };
  } catch (error) {
    return rejectWithValue(message(error, "Failed to connect the calendar account"));
  }
});

export const updateConnectedCalendar = createAsyncThunk<
  CalendarConnectionInfo,
  {
    connectedCalendarId: string;
    syncEnabled?: boolean;
    direction?: CalendarSyncDirection;
    countsAsBusy?: boolean;
  },
  ThunkConfig
>("calendarConnections/updateCalendar", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await connectionsApi.updateConnectedCalendar({
      organizationId,
      connectedCalendarId: params.connectedCalendarId,
      syncEnabled: params.syncEnabled,
      direction: params.direction === undefined ? undefined : DIRECTION_TO_PROTO[params.direction],
      countsAsBusy: params.countsAsBusy,
    });
    const connection = requireConnection(response.connection);
    // Sync adds or removes a calendar's events; direction decides whether they can be edited.
    await dispatch(fetchCalendars());
    if (params.syncEnabled !== undefined || params.direction !== undefined) {
      await refreshVisibleRange(getState(), dispatch);
    }
    return connection;
  } catch (error) {
    return rejectWithValue(message(error, "Failed to update the connected calendar"));
  }
});

const connectionAction = (
  type: string,
  fallback: string,
  call: (request: {
    organizationId: string;
    connectionId: string;
  }) => Promise<{ connection?: ProtoConnection }>,
) =>
  createAsyncThunk<CalendarConnectionInfo, string, ThunkConfig>(
    type,
    async (connectionId, { getState, rejectWithValue, dispatch }) => {
      try {
        const organizationId = getOrganizationId(getState());
        const response = await call({ organizationId, connectionId });
        const connection = requireConnection(response.connection);
        // Each calendar row in the sidebar shows the account's state.
        await dispatch(fetchCalendars());
        return connection;
      } catch (error) {
        return rejectWithValue(message(error, fallback));
      }
    },
  );

export const pauseCalendarConnection = connectionAction(
  "calendarConnections/pause",
  "Failed to pause syncing",
  (request) => connectionsApi.pauseCalendarConnection(request),
);

export const resumeCalendarConnection = connectionAction(
  "calendarConnections/resume",
  "Failed to resume syncing",
  (request) => connectionsApi.resumeCalendarConnection(request),
);

export const syncCalendarConnectionNow = connectionAction(
  "calendarConnections/syncNow",
  "Failed to sync the account",
  (request) => connectionsApi.syncCalendarConnectionNow(request),
);

export const disconnectCalendarConnection = createAsyncThunk<string, string, ThunkConfig>(
  "calendarConnections/disconnect",
  async (connectionId, { getState, rejectWithValue, dispatch }) => {
    try {
      const organizationId = getOrganizationId(getState());
      await connectionsApi.disconnectCalendarConnection({ organizationId, connectionId });
      // Kept calendars become ordinary ones, so their events turn editable.
      await dispatch(fetchCalendars());
      await refreshVisibleRange(getState(), dispatch);
      return connectionId;
    } catch (error) {
      return rejectWithValue(message(error, "Failed to disconnect the account"));
    }
  },
);

export const fetchCalendarProviderSettings = createAsyncThunk<
  ProviderSettingsInfo,
  void,
  ThunkConfig
>("calendarConnections/providerSettings", async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await connectionsApi.getCalendarProviderSettings({ organizationId });
    return providerSettingsFromProto(response);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to load the calendar provider settings"));
  }
});

export const updateCalendarProviderSettings = createAsyncThunk<
  ProviderSettingsInfo,
  {
    provider: CalendarProviderId;
    clientId?: string;
    /** Empty keeps the stored secret. */
    clientSecret?: string;
    tenant?: string;
    /** Remove this organization's app and fall back to the deployment's. */
    clear?: boolean;
  },
  ThunkConfig
>("calendarConnections/updateProviderSettings", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await connectionsApi.updateCalendarProviderSettings({
      organizationId,
      provider: PROVIDER_TO_PROTO[params.provider],
      clientId: params.clientId ?? "",
      clientSecret: params.clientSecret ?? "",
      tenant: params.tenant ?? "",
      clear: params.clear ?? false,
    });
    return providerSettingsFromProto(response);
  } catch (error) {
    return rejectWithValue(message(error, "Failed to save the calendar provider settings"));
  }
});
