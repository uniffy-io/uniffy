import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';

/** Persisted device picks and ring behavior; media state itself never persists. */
export interface CallPreferencesState {
  audioInputId: string | null;
  videoInputId: string | null;
  audioOutputId: string | null;
  ringtoneEnabled: boolean;
  /** Last drag-resized CallView height in px; null = default 40%. */
  viewHeightPx: number | null;
}

const initialState: CallPreferencesState = {
  audioInputId: null,
  videoInputId: null,
  audioOutputId: null,
  ringtoneEnabled: true,
  viewHeightPx: null,
};

const callPreferencesSlice = createSlice({
  name: 'callPreferences',
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
  },
});

export const {
  audioInputSelected,
  videoInputSelected,
  audioOutputSelected,
  ringtoneToggled,
  viewHeightChanged,
} = callPreferencesSlice.actions;

export const callPreferencesReducer = callPreferencesSlice.reducer;

export const selectCallPreferences = (state: RootState) => state.callPreferences;
