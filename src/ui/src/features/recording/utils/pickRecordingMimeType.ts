/**
 * Pick the best supported video MIME for `MediaRecorder`.
 *
 * **WebM first on Chromium / Firefox; MP4 only on Safari.** Chromium's
 * `MediaRecorder` reports `isTypeSupported('video/mp4;...') = true` even
 * when the H.264 encoder cannot initialise on the user's machine, and then
 * fails async with `EncodingError: Encoder initialization failed` (observed
 * on Brave / Mac). The WebM path uses VP9/VP8 (always present in Chromium)
 * and never hits this trap. Safari's MediaRecorder produces well-formed
 * H.264/AAC MP4 reliably, but Safari does not support WebM so MP4 is the
 * only option there.
 *
 * The codec string MUST match the actual track count on the stream:
 * declaring `mp4a` (AAC) or `opus` when the stream has no audio track makes
 * `MediaRecorder` fail the moment recording starts. Pass `hasAudio=true`
 * only when the stream actually has an audio track.
 */

const VIDEO_AUDIO_PREFERENCE: readonly string[] = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
];

const VIDEO_ONLY_PREFERENCE: readonly string[] = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4',
];

export function pickRecordingMimeType(hasAudio: boolean = false): string | null {
    if (typeof MediaRecorder === 'undefined') {
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
    if (mime.startsWith('video/mp4')) return 'mp4';
    if (mime.startsWith('video/webm')) return 'webm';
    return 'bin';
}

/**
 * Strip the `;codecs=...` suffix from a MediaRecorder MIME so the value we
 * store on the File row is a generic container MIME (`video/mp4` /
 * `video/webm`). The codec-suffixed string the recorder hands out is fine
 * for encoding but trips up `<video>.canPlayType` in the viewer because the
 * `avc1`/`mp4a` four-CCs without dotted profiles aren't a valid playback
 * codec spec - players return "" (maybe-not-supported) and the viewer
 * fallback shows "format not supported".
 */
export function getContainerMimeType(mime: string): string {
    return mime.split(';')[0].trim();
}
