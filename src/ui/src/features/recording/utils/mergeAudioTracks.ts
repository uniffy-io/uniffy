/**
 * Mix any number of audio-bearing MediaStreams into a single audio track.
 *
 * - Zero audio sources: returns nulls. Recording proceeds video-only.
 * - One audio source: returns its track directly. No AudioContext is created;
 *   feeding the raw track to MediaRecorder is more reliable than routing
 *   through `MediaStreamDestinationNode` (which depends on AudioContext state
 *   and produces silence when the context auto-suspends after async permission
 *   flows).
 * - Two or more audio sources: routes through an AudioContext +
 *   `MediaStreamAudioDestinationNode` to produce a single mixed track. The
 *   context is `resume()`d up front because Chrome's autoplay policy can
 *   leave it `suspended` after `getUserMedia`/`getDisplayMedia` await
 *   boundaries; a suspended context emits no frames and the encoder errors.
 *   Caller must `.close()` the returned context on stop.
 */

export interface MergedAudio {
    track: MediaStreamTrack | null;
    audioContext: AudioContext | null;
}

export async function mergeAudioTracks(streams: MediaStream[]): Promise<MergedAudio> {
    const audioStreams = streams.filter((s) => s.getAudioTracks().length > 0);
    if (audioStreams.length === 0) {
        return { track: null, audioContext: null };
    }
    if (audioStreams.length === 1) {
        const directTrack = audioStreams[0].getAudioTracks()[0] ?? null;
        return { track: directTrack, audioContext: null };
    }

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    for (const stream of audioStreams) {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
    }

    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
        } catch {
            // not fatal; the recorder may still work, but log for diagnostics
        }
    }

    const track = destination.stream.getAudioTracks()[0] ?? null;
    return { track, audioContext };
}
