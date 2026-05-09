/**
 * Recording thunks - imperative side-effect-bearing actions that drive the
 * `recordingController` singleton and synchronise the slice state.
 *
 * Source / mic / tab-audio choices live on the slice (set by the popover)
 * and are read here at start-time. Pause/resume bridge the
 * `MediaRecorder.pause/resume` calls into slice transitions; cumulative
 * paused duration lives on the slice so the timer stays accurate.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '@/app/store';
import { recordingController } from '@/features/recording/utils/recordingController';
import { pickRecordingMimeType } from '@/features/recording/utils/pickRecordingMimeType';
import { fetchRecordingsFolderId } from '@/features/recording/utils/ensureRecordingsFolder';
import { fetchFile } from '@/features/files/store/filesThunks';
import { openViewer } from '@/features/files/store/viewerSlice';
import {
    acquireLock,
    releaseLock,
} from '@/features/recording/utils/crossTabRecordingLock';
import { resumeUpload } from '@/features/recording/utils/recoverOrphanedRecordings';
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
} from '@/features/recording/store/recordingSlice';
import type { BackpressureLevel } from '@/features/recording/utils/uploadBackpressure';

function backpressureToNetworkStatus(
    level: BackpressureLevel,
): 'online' | 'slow' | 'falling-behind' {
    switch (level) {
        case 'slow':
            return 'slow';
        case 'falling-behind':
        case 'auto-stop':
            return 'falling-behind';
        case 'normal':
        default:
            return 'online';
    }
}

interface ThunkApiConfig {
    state: RootState;
    dispatch: AppDispatch;
    rejectValue: string;
}

export const startRecording = createAsyncThunk<void, void, ThunkApiConfig>(
    'recording/start',
    async (_arg, { dispatch, getState, rejectWithValue }) => {
        const state = getState();
        const organizationId = state.auth?.currentOrganizationId;
        if (!organizationId) {
            return rejectWithValue('No active organization');
        }

        if (!pickRecordingMimeType(false) && !pickRecordingMimeType(true)) {
            dispatch(
                recordingFailed({
                    code: 'not_supported',
                    message: "Your browser doesn't support screen recording.",
                }),
            );
            return rejectWithValue('not_supported');
        }

        // First-time recording: pause here and surface the consent modal.
        // The modal's Continue button dispatches `firstUseAcknowledged` and
        // re-dispatches `startRecording`. The flag is persisted, so this
        // gate fires once per user.
        if (!state.recording.firstUseAcknowledged) {
            dispatch(firstUseModalOpened());
            return;
        }

        // Refuse to start if another tab of the same origin already holds
        // the recording lock. Two screen captures concurrently is a tab
        // bandwidth fight and a quota landmine; the second tab gets a
        // friendly toast instead.
        const lockResult = await acquireLock();
        if (!lockResult.acquired) {
            toast.error('Another tab is already recording. Stop that one first.');
            return rejectWithValue('lock_held_by_other_tab');
        }

        dispatch(startRequested());

        let folderId = state.recording.recordingsFolderId;
        try {
            if (!folderId) {
                folderId = await fetchRecordingsFolderId(organizationId);
                dispatch(recordingsFolderResolved(folderId));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to resolve folder';
            releaseLock();
            dispatch(recordingFailed({ code: 'unknown', message }));
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
                    dispatch(authStatusChanged('lost'));
                },
                onTrackEnded: () => {
                    void dispatch(stopRecording());
                },
                onError: (err) => {
                    dispatch(
                        recordingFailed({ code: 'unknown', message: err.message }),
                    );
                },
                onBackpressure: (level) => {
                    dispatch(networkStatusChanged(backpressureToNetworkStatus(level)));
                    if (level === 'auto-stop') {
                        // Memory / IndexedDB ceiling hit. Save what we have
                        // rather than crashing the tab. The slice will
                        // transition through stopping -> flushing -> done
                        // exactly as a manual Stop.
                        toast.error('Recording stopped: upload backlog too large.');
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
                e?.code === 'permission_denied'
                    ? 'permission_denied'
                    : e?.code === 'not_supported'
                        ? 'not_supported'
                        : 'unknown';
            const message = e?.message ?? 'Failed to start recording';
            // `getDisplayMedia` throws `NotAllowedError` for both the
            // OS-level deny and the user clicking Cancel on the browser
            // picker. Chrome does not differentiate. Treating cancel as
            // an "error" surfaces a toast + the floating "Recording
            // failed" tile, which is hostile UX for what is just an
            // intentional bail-out. Return silently so the global
            // errorToastMiddleware does not fire either.
            releaseLock();
            if (code === 'permission_denied') {
                dispatch(backToIdle());
                return;
            }
            dispatch(recordingFailed({ code, message }));
            if (code === 'not_supported') {
                toast.error("Your browser doesn't support screen recording.");
            }
            return rejectWithValue(message);
        }
    },
);

export const pauseRecording = createAsyncThunk<void, void, ThunkApiConfig>(
    'recording/pause',
    async (_arg, { dispatch, getState }) => {
        if (getState().recording.state !== 'recording') return;
        recordingController.pause();
        dispatch(recordingPaused({ pausedAt: Date.now() }));
    },
);

export const resumeRecording = createAsyncThunk<void, void, ThunkApiConfig>(
    'recording/resume',
    async (_arg, { dispatch, getState }) => {
        if (getState().recording.state !== 'paused') return;
        recordingController.resume();
        dispatch(recordingResumed({ resumedAt: Date.now() }));
    },
);

const MIN_VALID_RECORDING_MS = 1500;

export const stopRecording = createAsyncThunk<void, void, ThunkApiConfig>(
    'recording/stop',
    async (_arg, { dispatch, getState, rejectWithValue }) => {
        const state = getState();
        if (
            state.recording.state !== 'recording' &&
            state.recording.state !== 'paused'
        ) {
            return;
        }

        // Sub-second recordings are almost always accidental clicks (Start
        // immediately followed by Stop, or a misfired keyboard shortcut).
        // The S3 multipart with zero parts would also fail server-side on
        // completeUpload. Abort the multipart, drop any IndexedDB
        // bookkeeping, and surface a friendly toast instead of letting the
        // user think they saved a clip.
        const startedAt = state.recording.startedAt;
        const pausedDurationMs = state.recording.pausedDurationMs;
        const pausedAt = state.recording.pausedAt;
        const referenceNow = pausedAt ?? Date.now();
        const effectiveElapsedMs =
            startedAt !== null ? referenceNow - startedAt - pausedDurationMs : 0;
        if (effectiveElapsedMs < MIN_VALID_RECORDING_MS) {
            dispatch(stopRequested());
            try {
                await recordingController.cancel();
            } catch {
                // Cancel is best-effort; the server reaper handles strays.
            }
            releaseLock();
            dispatch(backToIdle());
            toast.error('Recording was too short to save.');
            return;
        }

        dispatch(stopRequested());

        try {
            dispatch(flushing());
            const result = await recordingController.stop();
            releaseLock();
            dispatch(completing());
            dispatch(
                recordingDone({ fileId: result.fileId, filename: result.filename }),
            );
            const recordingFileId = result.fileId;
            toast.success('Recording saved', {
                description: result.filename,
                action: {
                    label: 'Open',
                    onClick: () => {
                        // Open the viewer modal in place rather than
                        // navigating to /files - the modal is mounted
                        // globally and can stand alone with file data
                        // fetched via fetchFile.
                        void (async () => {
                            try {
                                const file = await dispatch(fetchFile(recordingFileId)).unwrap();
                                dispatch(openViewer({
                                    fileId: file.id,
                                    playlist: [file.id],
                                    fileData: file,
                                }));
                            } catch {
                                // If the fetch fails (race against a
                                // delete or quota abort), fall back to
                                // the files list so the user is not
                                // stranded on a stale toast click.
                                window.location.href = '/files';
                            }
                        })();
                    },
                },
            });
            window.setTimeout(() => {
                dispatch(backToIdle());
            }, 3000);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload failed';
            releaseLock();
            dispatch(recordingFailed({ code: 'upload_failed', message }));
            return rejectWithValue(message);
        }
    },
);

export const retryUpload = createAsyncThunk<void, void, ThunkApiConfig>(
    'recording/retryUpload',
    async (_arg, { dispatch, getState, rejectWithValue }) => {
        const state = getState().recording;
        if (state.state !== 'error' || state.uploadId === null) {
            return;
        }
        const uploadId = state.uploadId;
        dispatch(flushing());
        try {
            const result = await resumeUpload(uploadId);
            if (!result) {
                // Upload was already aborted/expired on the server.
                // Nothing recoverable; clear the slice and move on.
                dispatch(backToIdle());
                toast.error('Upload could not be retried; the recording session has expired.');
                return rejectWithValue('upload_no_longer_active');
            }
            dispatch(completing());
            dispatch(
                recordingDone({ fileId: result.fileId, filename: result.filename }),
            );
            const recordingFileId = result.fileId;
            toast.success('Recording saved', {
                description: result.filename,
                action: {
                    label: 'Open',
                    onClick: () => {
                        void (async () => {
                            try {
                                const file = await dispatch(fetchFile(recordingFileId)).unwrap();
                                dispatch(openViewer({
                                    fileId: file.id,
                                    playlist: [file.id],
                                    fileData: file,
                                }));
                            } catch {
                                window.location.href = '/files';
                            }
                        })();
                    },
                },
            });
            window.setTimeout(() => {
                dispatch(backToIdle());
            }, 3000);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Retry failed';
            dispatch(recordingFailed({ code: 'upload_failed', message }));
            return rejectWithValue(message);
        }
    },
);

export const setMicMuted = createAsyncThunk<void, boolean, ThunkApiConfig>(
    'recording/setMicMuted',
    async (muted, { dispatch, getState }) => {
        const recordingState = getState().recording.state;
        if (recordingState !== 'recording' && recordingState !== 'paused') {
            return;
        }
        recordingController.setMicMuted(muted);
        dispatch(micMuteChanged(muted));
    },
);

export const cancelRecording = createAsyncThunk<void, void, ThunkApiConfig>(
    'recording/cancel',
    async (_arg, { dispatch }) => {
        try {
            await recordingController.cancel();
        } finally {
            releaseLock();
            dispatch(backToIdle());
        }
    },
);
