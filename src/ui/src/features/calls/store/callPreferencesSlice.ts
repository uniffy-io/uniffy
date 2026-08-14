import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import type { RootState } from "@/app/store";

/** Persisted device picks and ring behavior; media state itself never persists. */
export interface CallPreferencesState {
  audioInputId: string | null;
  videoInputId: string | null;
  audioOutputId: string | null;
  ringtoneEnabled: boolean;
  /** Last drag-resized CallView height in px; null = default 40%. */
  viewHeightPx: number | null;
  /** Preferred screen-share ceiling; UNSPECIFIED follows the org-resolved cap. */
  screenShareQuality: ScreenShareQuality;
}

const initialState: CallPreferencesState = {
  audioInputId: null,
  videoInputId: null,
  audioOutputId: null,
  ringtoneEnabled: true,
  viewHeightPx: null,
  screenShareQuality: ScreenShareQuality.UNSPECIFIED,
};

const callPreferencesSlice = createSlice({
  name: "callPreferences",
  initialState,
  reducers: {
    audioInputSelected(state, action: PayloadAction<string | null>) {
      state.audioInputId = action.payload;
    },
    videoInputSelected(state, action: PayloadAction<string | null>) {
      state.videoInputId = action.payload;
    },
    audioOutputSelected(state, action: PayloadAction<string | null>) {
      state.audioOutputId = action.payload;
    },
    ringtoneToggled(state, action: PayloadAction<boolean>) {
      state.ringtoneEnabled = action.payload;
    },
    viewHeightChanged(state, action: PayloadAction<number | null>) {
      state.viewHeightPx = action.payload;
    },
    screenShareQualitySelected(state, action: PayloadAction<ScreenShareQuality>) {
      state.screenShareQuality = action.payload;
    },
  },
});

export const {
  audioInputSelected,
  videoInputSelected,
  audioOutputSelected,
  ringtoneToggled,
  viewHeightChanged,
  screenShareQualitySelected,
} = callPreferencesSlice.actions;

export const callPreferencesReducer = callPreferencesSlice.reducer;

export const selectCallPreferences = (state: RootState) => state.callPreferences;
