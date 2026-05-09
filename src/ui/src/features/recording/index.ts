/**
 * Public surface of the recording feature.
 *
 * The slice reducer is registered in `src/app/store.ts` as `recording`.
 * The trigger mounts in `AppHeader` and the controller in `App.tsx`.
 */

export { recordingReducer } from '@/features/recording/store/recordingSlice';
export type {
    RecordingSliceState,
    RecordingState,
    NetworkStatus,
    RecordingSource,
    ControllerCorner,
} from '@/features/recording/store/recordingSlice';
export {
    cancelRecording,
    pauseRecording,
    resumeRecording,
    retryUpload,
    setMicMuted,
    startRecording,
    stopRecording,
} from '@/features/recording/store/recordingThunks';
export { RecordingNavTrigger } from '@/features/recording/components/RecordingNavTrigger';
