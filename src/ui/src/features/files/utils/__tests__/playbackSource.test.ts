import { describe, expect, it } from "vitest";
import { PlaybackStatus, TranscodeStatus } from "@uniffy/proto/files/v1/files_pb";
import { playbackAfterError, playbackSourceType } from "@/features/files/utils/playbackSource";

describe("video playback", () => {
  it("normalizes QuickTime and codec parameters", () => {
    expect(playbackSourceType("video/quicktime")).toBe("video/mp4");
    expect(playbackSourceType('video/webm; codecs="vp9"')).toBe("video/webm");
  });
  it("waits for either background conversion", () => {
    const file = {
      version: 1,
      mimeType: "video/webm",
      playbackStatus: PlaybackStatus.NOT_NEEDED,
      transcodeStatus: TranscodeStatus.PROCESSING,
    };
    expect(playbackAfterError(file)).toBe("preparing");
    expect(
      playbackAfterError({
        ...file,
        transcodeStatus: TranscodeStatus.NOT_NEEDED,
        playbackStatus: PlaybackStatus.PENDING,
      }),
    ).toBe("preparing");
    expect(playbackAfterError({ ...file, playbackStatus: PlaybackStatus.COMPLETED })).toBe(
      "fallback",
    );
  });
  it("ends preparation on failure", () => {
    expect(
      playbackAfterError({
        version: 1,
        mimeType: "video/quicktime",
        playbackStatus: PlaybackStatus.FAILED,
        transcodeStatus: TranscodeStatus.NOT_NEEDED,
      }),
    ).toBe("unsupported");
  });
});
