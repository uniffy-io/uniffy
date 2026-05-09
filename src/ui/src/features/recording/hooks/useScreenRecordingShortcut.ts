/**
 * Global keyboard shortcut for screen recording.
 *
 * Default: `Ctrl+Alt+S`. Configurable via the keyboard-shortcuts settings.
 *
 * Behaviour matches Loom's quick-record hotkey:
 *   - idle / done / error: start a recording immediately with the last-used
 *     source / mic / tab-audio preferences. Skipping the popover is the
 *     point of a hotkey - if the user wanted to reconfigure, they would
 *     click the trigger.
 *   - recording / paused: stop the recording.
 *   - starting: cancel.
 *
 * Ignored when the user is typing in an input / textarea / contentEditable
 * (see `useShortcutHandler`).
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useShortcutHandler } from '@/features/settings';
import {
    cancelRecording,
    startRecording,
    stopRecording,
} from '@/features/recording/store/recordingThunks';

export function useScreenRecordingShortcut(enabled: boolean = true): void {
    const dispatch = useAppDispatch();
    const recordingState = useAppSelector((state) => state.recording.state);

    const handler = useCallback(() => {
        if (recordingState === 'recording' || recordingState === 'paused') {
            void dispatch(stopRecording());
            return;
        }
        if (recordingState === 'requesting' || recordingState === 'initiating-upload') {
            void dispatch(cancelRecording());
            return;
        }
        if (
            recordingState === 'idle' ||
            recordingState === 'done' ||
            recordingState === 'error'
        ) {
            void dispatch(startRecording());
        }
    }, [dispatch, recordingState]);

    useShortcutHandler('recording.toggleQuickClip', handler, { enabled });
}
