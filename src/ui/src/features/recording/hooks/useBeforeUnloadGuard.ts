import { useAppSelector } from "@/app/hooks";
import { useUnloadGuard } from "@/shared/hooks/useUnloadGuard";

const ACTIVE_STATES = new Set([
  "requesting",
  "initiating-upload",
  "recording",
  "paused",
  "stopping",
  "flushing",
  "completing",
]);

/** Guards the page while a recording or its upload is in flight. */
export function useBeforeUnloadGuard(): void {
  const recordingState = useAppSelector((state) => state.recording.state);
  useUnloadGuard(ACTIVE_STATES.has(recordingState));
}
