import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";

export interface CustomStatus {
  emoji: string;
  text: string;
  expiresAt: string | null;
}

interface PresenceState {
  statuses: Record<string, string>;
  customStatuses: Record<string, CustomStatus>;
}

const initialState: PresenceState = {
  statuses: {},
  customStatuses: {},
};

const presenceSlice = createSlice({
  name: "presence",
  initialState,
  reducers: {
    updatePresence(state, action: PayloadAction<{ userId: string; status: string }>) {
      state.statuses[action.payload.userId] = action.payload.status;
    },
    updatePresenceWithCustomStatus(
      state,
      action: PayloadAction<{
        userId: string;
        status: string;
        customStatus?: CustomStatus;
      }>,
    ) {
      const { userId, status, customStatus } = action.payload;
      state.statuses[userId] = status;
      if (customStatus) {
        state.customStatuses[userId] = customStatus;
      } else {
        delete state.customStatuses[userId];
      }
    },
    updateBulkPresence(
      state,
      action: PayloadAction<Record<string, { status: string; customStatus?: CustomStatus }>>,
    ) {
      for (const [userId, data] of Object.entries(action.payload)) {
        state.statuses[userId] = data.status;
        if (data.customStatus) {
          state.customStatuses[userId] = data.customStatus;
        }
      }
    },
    setMyCustomStatus(
      state,
      action: PayloadAction<{ userId: string; customStatus: CustomStatus }>,
    ) {
      state.customStatuses[action.payload.userId] = action.payload.customStatus;
    },
    clearMyCustomStatus(state, action: PayloadAction<string>) {
      delete state.customStatuses[action.payload];
    },
    clearPresence() {
      return initialState;
    },
  },
});

export const {
  updatePresence,
  updatePresenceWithCustomStatus,
  updateBulkPresence,
  setMyCustomStatus,
  clearMyCustomStatus,
  clearPresence,
} = presenceSlice.actions;

export const selectPresenceStatus = (state: RootState, userId: string): string =>
  state.presence.statuses[userId] ?? "offline";

export const selectCustomStatus = (state: RootState, userId: string): CustomStatus | undefined =>
  state.presence.customStatuses[userId];

export const presenceReducer = presenceSlice.reducer;
