import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import type { RootState } from "@/app/store";
import { DEFAULT_BLUR_STRENGTH, type BlurStrength } from "@/features/calls/utils/blurStrength";

/** Persisted device picks and ring behavior; media state itself never persists. */
export interface CallPreferencesState {
  audioInputId: string | null;
  videoInputId: string | null;
  audioOutputId: string | null;
  ringtoneEnabled: boolean;
  joinMuted: boolean;
  cameraOn: boolean;
  backgroundBlur: boolean;
  backgroundBlurStrength: BlurStrength;
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
  joinMuted: true,
  cameraOn: false,
  backgroundBlur: false,
  backgroundBlurStrength: DEFAULT_BLUR_STRENGTH,
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
    joinMutedChanged(state, action: PayloadAction<boolean>) {
      state.joinMuted = action.payload;
    },
    cameraOnChanged(state, action: PayloadAction<boolean>) {
      state.cameraOn = action.payload;
    },
    backgroundBlurChanged(state, action: PayloadAction<boolean>) {
      state.backgroundBlur = action.payload;
    },
    backgroundBlurStrengthChanged(state, action: PayloadAction<BlurStrength>) {
      state.backgroundBlurStrength = action.payload;
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
  joinMutedChanged,
  cameraOnChanged,
  backgroundBlurChanged,
  backgroundBlurStrengthChanged,
  viewHeightChanged,
  screenShareQualitySelected,
} = callPreferencesSlice.actions;

export const callPreferencesReducer = callPreferencesSlice.reducer;

export const selectCallPreferences = (state: RootState) => state.callPreferences;
