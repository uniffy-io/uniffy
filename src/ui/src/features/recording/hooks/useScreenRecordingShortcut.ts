import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import {
  cancelRecording,
  startRecording,
  stopRecording,
} from "@/features/recording/store/recordingThunks";

export function useScreenRecordingShortcut(enabled: boolean = true): void {
  const dispatch = useAppDispatch();
  const recordingState = useAppSelector((state) => state.recording.state);

  const handler = useCallback(() => {
    if (recordingState === "recording" || recordingState === "paused") {
      void dispatch(stopRecording());
      return;
    }
    if (recordingState === "requesting" || recordingState === "initiating-upload") {
      void dispatch(cancelRecording());
      return;
    }
    if (recordingState === "idle" || recordingState === "done" || recordingState === "error") {
      void dispatch(startRecording());
    }
  }, [dispatch, recordingState]);

  useShortcutHandler("recording.toggleQuickClip", handler, { enabled });
}
