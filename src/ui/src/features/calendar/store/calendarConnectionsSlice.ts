import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import {
  completeCalendarConnection,
  disconnectCalendarConnection,
  fetchCalendarConnections,
  fetchCalendarProviderSettings,
  pauseCalendarConnection,
  resumeCalendarConnection,
  syncCalendarConnectionNow,
  updateCalendarProviderSettings,
  updateConnectedCalendar,
} from "@/features/calendar/store/calendarConnectionsThunks";
import type {
  CalendarConnectionInfo,
  ProviderAvailabilityInfo,
  ProviderSettingsInfo,
} from "@/features/calendar/types/connections";

export interface CalendarConnectionsState {
  connections: CalendarConnectionInfo[];
  providers: ProviderAvailabilityInfo[];
  canConnect: boolean;
  /** True once the list has answered for this organization. */
  loaded: boolean;
  loading: boolean;
  /** The last list load failed; cleared when the next one starts. */
  error: string | null;
  /** The connections dialog; `focusConnectionId` scrolls one account into view. */
  dialog: { focusConnectionId: string | null } | null;
  /** Org admins only. */
  providerSettings: ProviderSettingsInfo | null;
}

const initialState: CalendarConnectionsState = {
  connections: [],
  providers: [],
  canConnect: false,
  loaded: false,
  loading: false,
  error: null,
  dialog: null,
  providerSettings: null,
};

const storeConnection = (state: CalendarConnectionsState, connection: CalendarConnectionInfo) => {
  const index = state.connections.findIndex((entry) => entry.id === connection.id);
  if (index === -1) state.connections.push(connection);
  else state.connections[index] = connection;
};

const calendarConnectionsSlice = createSlice({
  name: "calendarConnections",
  initialState,
  reducers: {
    openConnectionsDialog: (state, action: PayloadAction<string | null | undefined>) => {
      state.dialog = { focusConnectionId: action.payload ?? null };
    },
    closeConnectionsDialog: (state) => {
      state.dialog = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCalendarConnections.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCalendarConnections.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = null;
        state.connections = action.payload.connections;
        state.providers = action.payload.providers;
        state.canConnect = action.payload.canConnect;
      })
      .addCase(fetchCalendarConnections.rejected, (state, action) => {
        state.loading = false;
        state.error =
          action.payload ?? action.error.message ?? "Failed to load connected calendars";
      })
      .addCase(completeCalendarConnection.fulfilled, (state, action) =>
        storeConnection(state, action.payload.connection),
      )
      .addCase(updateConnectedCalendar.fulfilled, (state, action) =>
        storeConnection(state, action.payload),
      )
      .addCase(pauseCalendarConnection.fulfilled, (state, action) =>
        storeConnection(state, action.payload),
      )
      .addCase(resumeCalendarConnection.fulfilled, (state, action) =>
        storeConnection(state, action.payload),
      )
      .addCase(syncCalendarConnectionNow.fulfilled, (state, action) =>
        storeConnection(state, action.payload),
      )
      .addCase(disconnectCalendarConnection.fulfilled, (state, action) => {
        state.connections = state.connections.filter((entry) => entry.id !== action.payload);
      })
      .addCase(fetchCalendarProviderSettings.fulfilled, (state, action) => {
        state.providerSettings = action.payload;
      })
      .addCase(updateCalendarProviderSettings.fulfilled, (state, action) => {
        state.providerSettings = action.payload;
      });
  },
});

export const { openConnectionsDialog, closeConnectionsDialog } = calendarConnectionsSlice.actions;
export const calendarConnectionsReducer = calendarConnectionsSlice.reducer;
