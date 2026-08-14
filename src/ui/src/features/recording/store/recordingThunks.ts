import { createAsyncThunk } from "@reduxjs/toolkit";
import { toast } from "sonner";
import type { AppDispatch, RootState } from "@/app/store";
import { recordingController } from "@/features/recording/utils/recordingController";
import { pickRecordingMimeType } from "@/features/recording/utils/pickRecordingMimeType";
import { fetchRecordingsFolderId } from "@/features/recording/utils/ensureRecordingsFolder";
import { fetchFile } from "@/features/files/store/filesThunks";
import { openViewer } from "@/features/files/store/viewerSlice";
import { acquireLock, releaseLock } from "@/features/recording/utils/crossTabRecordingLock";
import { resumeUpload } from "@/features/recording/utils/recoverOrphanedRecordings";
import {
  backToIdle,
  bytesProgress,
  completing,
  firstUseModalOpened,
  flushing,
  micMuteChanged,
  networkStatusChanged,
  recordingDone,
  recordingFailed,
  recordingPaused,
  recordingResumed,
  recordingsFolderResolved,
  recordingStarted,
  startRequested,
  stopRequested,
  uploadInitiating,
  authStatusChanged,
} from "@/features/recording/store/recordingSlice";
import type { BackpressureLevel } from "@/features/recording/utils/uploadBackpressure";

function backpressureToNetworkStatus(
  level: BackpressureLevel,
): "online" | "slow" | "falling-behind" {
  switch (level) {
    case "slow":
      return "slow";
    case "falling-behind":
    case "auto-stop":
      return "falling-behind";
    case "normal":
    default:
      return "online";
  }
}

interface ThunkApiConfig {
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}

export const startRecording = createAsyncThunk<void, void, ThunkApiConfig>(
  "recording/start",
  async (_arg, { dispatch, getState, rejectWithValue }) => {
    const state = getState();
    const organizationId = state.auth?.currentOrganizationId;
    if (!organizationId) {
      return rejectWithValue("No active organization");
    }

    if (!pickRecordingMimeType(false) && !pickRecordingMimeType(true)) {
      dispatch(
        recordingFailed({
          code: "not_supported",
          message: "Your browser doesn't support screen recording.",
        }),
      );
      return rejectWithValue("not_supported");
    }

    // First-time consent modal gates the start; persisted flag fires once per user.
    if (!state.recording.firstUseAcknowledged) {
      dispatch(firstUseModalOpened());
      return;
    }

    // Refuse if another same-origin tab holds the recording lock.
    const lockResult = await acquireLock();
    if (!lockResult.acquired) {
      toast.error("Another tab is already recording. Stop that one first.");
      return rejectWithValue("lock_held_by_other_tab");
    }

    dispatch(startRequested());

    let folderId = state.recording.recordingsFolderId;
    try {
      if (!folderId) {
        folderId = await fetchRecordingsFolderId(organizationId);
        dispatch(recordingsFolderResolved(folderId));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve folder";
      releaseLock();
      dispatch(recordingFailed({ code: "unknown", message }));
      return rejectWithValue(message);
    }

    dispatch(uploadInitiating());

    try {
      const result = await recordingController.start({
        organizationId,
        folderId,
        source: state.recording.source,
        micDeviceId: state.recording.micDeviceId,
        captureTabAudio: state.recording.captureTabAudio,
        onChunkUploaded: (info) => {
          dispatch(bytesProgress(info));
        },
        onAuthLost: () => {
          dispatch(authStatusChanged("lost"));
        },
        onTrackEnded: () => {
          void dispatch(stopRecording());
        },
        onError: (err) => {
          dispatch(recordingFailed({ code: "unknown", message: err.message }));
        },
        onBackpressure: (level) => {
          dispatch(networkStatusChanged(backpressureToNetworkStatus(level)));
          if (level === "auto-stop") {
            // Backlog ceiling hit: save what we have rather than crashing the tab.
            toast.error("Recording stopped: upload backlog too large.");
            void dispatch(stopRecording());
          }
        },
      });
      dispatch(
        recordingStarted({
          uploadId: result.uploadId,
          startedAt: Date.now(),
        }),
      );
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const code =
        e?.code === "permission_denied"
          ? "permission_denied"
          : e?.code === "not_supported"
            ? "not_supported"
            : "unknown";
      const message = e?.message ?? "Failed to start recording";
      // `getDisplayMedia` throws NotAllowedError for both OS-level deny and the user
      // clicking Cancel on the browser picker (Chrome does not differentiate). Treat as silent bail-out.
      releaseLock();
      if (code === "permission_denied") {
        dispatch(backToIdle());
        return;
      }
      dispatch(recordingFailed({ code, message }));
      if (code === "not_supported") {
        toast.error("Your browser doesn't support screen recording.");
      }
      return rejectWithValue(message);
    }
  },
);

export const pauseRecording = createAsyncThunk<void, void, ThunkApiConfig>(
  "recording/pause",
  async (_arg, { dispatch, getState }) => {
    if (getState().recording.state !== "recording") return;
    recordingController.pause();
    dispatch(recordingPaused({ pausedAt: Date.now() }));
  },
);

export const resumeRecording = createAsyncThunk<void, void, ThunkApiConfig>(
  "recording/resume",
  async (_arg, { dispatch, getState }) => {
    if (getState().recording.state !== "paused") return;
    recordingController.resume();
    dispatch(recordingResumed({ resumedAt: Date.now() }));
  },
);

const MIN_VALID_RECORDING_MS = 1500;

export const stopRecording = createAsyncThunk<void, void, ThunkApiConfig>(
  "recording/stop",
  async (_arg, { dispatch, getState, rejectWithValue }) => {
    const state = getState();
    if (state.recording.state !== "recording" && state.recording.state !== "paused") {
      return;
    }

    // Sub-second recordings are accidental clicks; a zero-part multipart also fails completeUpload server-side.
    const startedAt = state.recording.startedAt;
    const pausedDurationMs = state.recording.pausedDurationMs;
    const pausedAt = state.recording.pausedAt;
    const referenceNow = pausedAt ?? Date.now();
    const effectiveElapsedMs = startedAt !== null ? referenceNow - startedAt - pausedDurationMs : 0;
    if (effectiveElapsedMs < MIN_VALID_RECORDING_MS) {
      dispatch(stopRequested());
      try {
        await recordingController.cancel();
      } catch {
        // Cancel is best-effort; the server reaper handles strays.
      }
      releaseLock();
      dispatch(backToIdle());
      toast.error("Recording was too short to save.");
      return;
    }

    dispatch(stopRequested());

    try {
      dispatch(flushing());
      const result = await recordingController.stop();
      releaseLock();
      dispatch(completing());
      dispatch(recordingDone({ fileId: result.fileId, filename: result.filename }));
      const recordingFileId = result.fileId;
      toast.success("Recording saved", {
        description: result.filename,
        action: {
          label: "Open",
          onClick: () => {
            void (async () => {
              try {
                const file = await dispatch(fetchFile(recordingFileId)).unwrap();
                dispatch(
                  openViewer({
                    fileId: file.id,
                    playlist: [file.id],
                    fileData: file,
                  }),
                );
              } catch {
                window.location.href = "/files";
              }
            })();
          },
        },
      });
      window.setTimeout(() => {
        dispatch(backToIdle());
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      releaseLock();
      dispatch(recordingFailed({ code: "upload_failed", message }));
      return rejectWithValue(message);
    }
  },
);

export const retryUpload = createAsyncThunk<void, void, ThunkApiConfig>(
  "recording/retryUpload",
  async (_arg, { dispatch, getState, rejectWithValue }) => {
    const state = getState().recording;
    if (state.state !== "error" || state.uploadId === null) {
      return;
    }
    const uploadId = state.uploadId;
    dispatch(flushing());
    try {
      const result = await resumeUpload(uploadId);
      if (!result) {
        // Upload already aborted/expired server-side; nothing recoverable.
        dispatch(backToIdle());
        toast.error("Upload could not be retried; the recording session has expired.");
        return rejectWithValue("upload_no_longer_active");
      }
      dispatch(completing());
      dispatch(recordingDone({ fileId: result.fileId, filename: result.filename }));
      const recordingFileId = result.fileId;
      toast.success("Recording saved", {
        description: result.filename,
        action: {
          label: "Open",
          onClick: () => {
            void (async () => {
              try {
                const file = await dispatch(fetchFile(recordingFileId)).unwrap();
                dispatch(
                  openViewer({
                    fileId: file.id,
                    playlist: [file.id],
                    fileData: file,
                  }),
                );
              } catch {
                window.location.href = "/files";
              }
            })();
          },
        },
      });
      window.setTimeout(() => {
        dispatch(backToIdle());
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retry failed";
      dispatch(recordingFailed({ code: "upload_failed", message }));
      return rejectWithValue(message);
    }
  },
);

export const setMicMuted = createAsyncThunk<void, boolean, ThunkApiConfig>(
  "recording/setMicMuted",
  async (muted, { dispatch, getState }) => {
    const recordingState = getState().recording.state;
    if (recordingState !== "recording" && recordingState !== "paused") {
      return;
    }
    recordingController.setMicMuted(muted);
    dispatch(micMuteChanged(muted));
  },
);

export const cancelRecording = createAsyncThunk<void, void, ThunkApiConfig>(
  "recording/cancel",
  async (_arg, { dispatch }) => {
    try {
      await recordingController.cancel();
    } finally {
      releaseLock();
      dispatch(backToIdle());
    }
  },
);
