/**
 * WebM (VP9/VP8) first on Chromium/Firefox; MP4 only on Safari. Chromium's `isTypeSupported('video/mp4;...')`
 * lies and the H.264 encoder fails async with EncodingError on Brave/Mac. Codec string MUST match the actual
 * track count - declaring `mp4a`/`opus` without an audio track fails `MediaRecorder.start()`.
 */

const VIDEO_AUDIO_PREFERENCE: readonly string[] = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4;codecs=h264,aac",
  "video/mp4",
];

const VIDEO_ONLY_PREFERENCE: readonly string[] = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4;codecs=h264",
  "video/mp4",
];

export function pickRecordingMimeType(hasAudio: boolean = false): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  const preference = hasAudio ? VIDEO_AUDIO_PREFERENCE : VIDEO_ONLY_PREFERENCE;
  for (const mime of preference) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return null;
}

export function getFileExtensionForMime(mime: string): string {
  if (mime.startsWith("video/mp4")) return "mp4";
  if (mime.startsWith("video/webm")) return "webm";
  return "bin";
}

/** Strip `;codecs=...` so the stored MIME is the generic container; bare four-CCs trip up `<video>.canPlayType`. */
export function getContainerMimeType(mime: string): string {
  return mime.split(";")[0].trim();
}
