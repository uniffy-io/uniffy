/** Screen recording state machine. Live state wipes on rehydrate (MediaStream cannot survive a reload); persisted picker prefs only. */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type RecordingState =
  | "idle"
  | "requesting"
  | "initiating-upload"
  | "recording"
  | "paused"
  | "stopping"
  | "flushing"
  | "completing"
  | "done"
  | "error";

export type NetworkStatus = "online" | "offline" | "slow" | "falling-behind";

export type RecordingSource = "screen" | "window" | "tab";

export type ControllerCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface RecordingErrorInfo {
  code: "permission_denied" | "not_supported" | "upload_failed" | "unknown";
  message: string;
}

export interface RecordingsRecent {
  fileId: string;
  filename: string;
  finishedAt: number;
}

export interface RecordingSliceState {
  state: RecordingState;
  network: NetworkStatus;
  auth: "ok" | "lost";
  uploadId: string | null;
  recordingsFolderId: string | null;
  startedAt: number | null;
  pausedDurationMs: number;
  pausedAt: number | null;
  bytesQueued: number;
  bytesUploaded: number;
  lastFileId: string | null;
  error: RecordingErrorInfo | null;
  recents: RecordingsRecent[];
  source: RecordingSource;
  micDeviceId: string | null;
  captureTabAudio: boolean;
  controllerCorner: ControllerCorner;
  controllerCollapsed: boolean;
  micMuted: boolean;
  firstUseAcknowledged: boolean;
  firstUseModalOpen: boolean;
}

const initialState: RecordingSliceState = {
  state: "idle",
  network: "online",
  auth: "ok",
  uploadId: null,
  recordingsFolderId: null,
  startedAt: null,
  pausedDurationMs: 0,
  pausedAt: null,
  bytesQueued: 0,
  bytesUploaded: 0,
  lastFileId: null,
  error: null,
  recents: [],
  source: "screen",
  micDeviceId: null,
  captureTabAudio: false,
  controllerCorner: "bottom-right",
  controllerCollapsed: false,
  micMuted: false,
  firstUseAcknowledged: false,
  firstUseModalOpen: false,
};

const RECENTS_CAP = 10;

const recordingSlice = createSlice({
  name: "recording",
  initialState,
  reducers: {
    startRequested(state) {
      state.state = "requesting";
      state.error = null;
      state.bytesQueued = 0;
      state.bytesUploaded = 0;
      state.uploadId = null;
      state.startedAt = null;
      state.pausedDurationMs = 0;
      state.pausedAt = null;
    },
    uploadInitiating(state) {
      state.state = "initiating-upload";
    },
    recordingStarted(state, action: PayloadAction<{ uploadId: string; startedAt: number }>) {
      state.state = "recording";
      state.uploadId = action.payload.uploadId;
      state.startedAt = action.payload.startedAt;
      state.pausedDurationMs = 0;
      state.pausedAt = null;
      state.micMuted = false;
    },
    recordingPaused(state, action: PayloadAction<{ pausedAt: number }>) {
      if (state.state !== "recording") return;
      state.state = "paused";
      state.pausedAt = action.payload.pausedAt;
    },
    recordingResumed(state, action: PayloadAction<{ resumedAt: number }>) {
      if (state.state !== "paused" || state.pausedAt === null) return;
      state.pausedDurationMs += action.payload.resumedAt - state.pausedAt;
      state.pausedAt = null;
      state.state = "recording";
    },
    stopRequested(state) {
      state.state = "stopping";
      // Fold in-flight pause window into cumulative total before the timer freezes.
      if (state.pausedAt !== null) {
        state.pausedDurationMs += Date.now() - state.pausedAt;
        state.pausedAt = null;
      }
    },
    flushing(state) {
      state.state = "flushing";
    },
    completing(state) {
      state.state = "completing";
    },
    recordingDone(state, action: PayloadAction<{ fileId: string; filename: string }>) {
      state.state = "done";
      state.lastFileId = action.payload.fileId;
      const recent: RecordingsRecent = {
        fileId: action.payload.fileId,
        filename: action.payload.filename,
        finishedAt: Date.now(),
      };
      state.recents = [recent, ...state.recents].slice(0, RECENTS_CAP);
    },
    backToIdle(state) {
      state.state = "idle";
      state.uploadId = null;
      state.startedAt = null;
      state.pausedDurationMs = 0;
      state.pausedAt = null;
      state.bytesQueued = 0;
      state.bytesUploaded = 0;
      state.error = null;
      state.micMuted = false;
    },
    recordingFailed(state, action: PayloadAction<RecordingErrorInfo>) {
      state.state = "error";
      state.error = action.payload;
      state.pausedAt = null;
    },
    bytesProgress(state, action: PayloadAction<{ queued: number; uploaded: number }>) {
      state.bytesQueued = action.payload.queued;
      state.bytesUploaded = action.payload.uploaded;
    },
    networkStatusChanged(state, action: PayloadAction<NetworkStatus>) {
      state.network = action.payload;
    },
    authStatusChanged(state, action: PayloadAction<"ok" | "lost">) {
      state.auth = action.payload;
    },
    recordingsFolderResolved(state, action: PayloadAction<string>) {
      state.recordingsFolderId = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
    sourceChanged(state, action: PayloadAction<RecordingSource>) {
      state.source = action.payload;
    },
    micDeviceChanged(state, action: PayloadAction<string | null>) {
      state.micDeviceId = action.payload;
    },
    captureTabAudioChanged(state, action: PayloadAction<boolean>) {
      state.captureTabAudio = action.payload;
    },
    controllerCornerChanged(state, action: PayloadAction<ControllerCorner>) {
      state.controllerCorner = action.payload;
    },
    controllerCollapsedChanged(state, action: PayloadAction<boolean>) {
      state.controllerCollapsed = action.payload;
    },
    micMuteChanged(state, action: PayloadAction<boolean>) {
      state.micMuted = action.payload;
    },
    firstUseModalOpened(state) {
      state.firstUseModalOpen = true;
    },
    firstUseModalClosed(state) {
      state.firstUseModalOpen = false;
    },
    firstUseAcknowledged(state) {
      state.firstUseAcknowledged = true;
      state.firstUseModalOpen = false;
    },
  },
});

export const {
  startRequested,
  uploadInitiating,
  recordingStarted,
  recordingPaused,
  recordingResumed,
  stopRequested,
  flushing,
  completing,
  recordingDone,
  backToIdle,
  recordingFailed,
  bytesProgress,
  networkStatusChanged,
  authStatusChanged,
  recordingsFolderResolved,
  clearError,
  sourceChanged,
  micDeviceChanged,
  captureTabAudioChanged,
  controllerCornerChanged,
  controllerCollapsedChanged,
  micMuteChanged,
  firstUseModalOpened,
  firstUseModalClosed,
  firstUseAcknowledged,
} = recordingSlice.actions;

export const recordingReducer = recordingSlice.reducer;
