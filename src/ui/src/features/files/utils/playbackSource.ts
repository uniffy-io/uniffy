import { PlaybackStatus, TranscodeStatus } from "@uniffy/proto/files/v1/files_pb";

export const PREPARING_VIDEO = "Preparing this video. Longer videos can take a few minutes.";
export const UNSUPPORTED_VIDEO = "This video cannot play here. Download it to watch.";

export function playbackSourceType(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return base === "video/quicktime" ? "video/mp4" : base || "video/mp4";
}

export interface PlaybackFile {
  version: number;
  mimeType: string;
  playbackStatus: PlaybackStatus;
  transcodeStatus: TranscodeStatus;
}

export function playbackAfterError(file: PlaybackFile): "fallback" | "preparing" | "unsupported" {
  if (file.playbackStatus === PlaybackStatus.COMPLETED) return "fallback";
  if (
    file.playbackStatus === PlaybackStatus.PENDING ||
    file.playbackStatus === PlaybackStatus.PROCESSING ||
    file.transcodeStatus === TranscodeStatus.PENDING ||
    file.transcodeStatus === TranscodeStatus.PROCESSING
  )
    return "preparing";
  return "unsupported";
}
