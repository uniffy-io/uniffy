import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getFileExtensionForMime, pickRecordingMimeType } from "../utils/pickRecordingMimeType";

describe("getFileExtensionForMime", () => {
  it("maps MP4 variants to mp4", () => {
    expect(getFileExtensionForMime("video/mp4;codecs=avc1,mp4a")).toBe("mp4");
    expect(getFileExtensionForMime("video/mp4")).toBe("mp4");
  });

  it("maps WebM variants to webm", () => {
    expect(getFileExtensionForMime("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(getFileExtensionForMime("video/webm")).toBe("webm");
  });

  it("falls back to bin for unrecognised MIME", () => {
    expect(getFileExtensionForMime("audio/mpeg")).toBe("bin");
  });
});

describe("pickRecordingMimeType", () => {
  const originalMR = globalThis.MediaRecorder;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = originalMR;
  });

  it("returns null when MediaRecorder is unavailable", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).MediaRecorder;
    expect(pickRecordingMimeType()).toBeNull();
  });

  it("prefers WebM over MP4 when both are supported (video-only)", () => {
    const isTypeSupported = vi.fn().mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = { isTypeSupported };
    expect(pickRecordingMimeType(false)).toBe("video/webm;codecs=vp9");
  });

  it("prefers WebM with Opus when stream has audio", () => {
    const isTypeSupported = vi.fn().mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = { isTypeSupported };
    expect(pickRecordingMimeType(true)).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls back to MP4 when no WebM variant is supported (Safari path)", () => {
    const isTypeSupported = vi.fn((mime: string) => mime.startsWith("video/mp4"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = { isTypeSupported };
    expect(pickRecordingMimeType(false)).toBe("video/mp4;codecs=avc1");
    expect(pickRecordingMimeType(true)).toBe("video/mp4;codecs=avc1,mp4a");
  });

  it("returns null when neither container is supported", () => {
    const isTypeSupported = vi.fn().mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = { isTypeSupported };
    expect(pickRecordingMimeType()).toBeNull();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });
});
