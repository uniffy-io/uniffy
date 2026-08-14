/**
 * Mixes audio-bearing streams into a single track. Single source: raw track passthrough (AudioContext
 * suspends after async permission flows on Chrome and emits silence). Multi-source: AudioContext +
 * MediaStreamAudioDestinationNode, resumed up front. Caller must `.close()` the returned context.
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

  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {
      // not fatal; the recorder may still work, but log for diagnostics
    }
  }

  const track = destination.stream.getAudioTracks()[0] ?? null;
  return { track, audioContext };
}
