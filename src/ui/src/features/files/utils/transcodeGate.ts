/**
 * Helpers for gating user actions while a server-side transcode is in
 * flight. The user always sees a `.mp4` filename; the bytes on S3 may
 * still be WebM until the worker swaps `storage_key`. Letting the user
 * download in that window would deliver a `.mp4` whose contents are
 * actually WebM - unplayable in QuickTime / Finder / iOS. The media
 * route answers 425 in the same window, so playback waits too.
 */

import { TranscodeStatus } from "@uniffy/proto/files/v1/files_pb";

export interface DownloadGateState {
  disabled: boolean;
  tooltip: string | null;
  failed: boolean;
}

const PENDING_TOOLTIP = "Optimising for download. Try again shortly.";
const FAILED_TOOLTIP = "Optimisation failed - plays in browser";

export function isTranscodePending(transcodeStatus: TranscodeStatus | undefined | null): boolean {
  return (
    transcodeStatus === TranscodeStatus.PENDING || transcodeStatus === TranscodeStatus.PROCESSING
  );
}

export function getDownloadGateState(
  transcodeStatus: TranscodeStatus | undefined | null,
): DownloadGateState {
  if (isTranscodePending(transcodeStatus)) {
    return { disabled: true, tooltip: PENDING_TOOLTIP, failed: false };
  }
  if (transcodeStatus === TranscodeStatus.FAILED) {
    return { disabled: false, tooltip: FAILED_TOOLTIP, failed: true };
  }
  return { disabled: false, tooltip: null, failed: false };
}
