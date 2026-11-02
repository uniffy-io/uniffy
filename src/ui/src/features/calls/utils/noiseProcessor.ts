import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { NOISE_PROCESSOR_NAME, SuspendedAudioError } from "@/features/calls/utils/noiseSuppression";

// RNNoise is trained on 48 kHz frames. The browser resamples the mic into this context.
const SAMPLE_RATE = 48_000;
const PROBE_INTERVAL_MS = 500;
const DEAD_PROBES = 4;

let wasm: Promise<ArrayBuffer> | undefined;

function loadWasm() {
  wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((error: unknown) => {
    wasm = undefined;
    throw error;
  });
  return wasm;
}

/** RNNoise on the mic track. Owns its own context because LiveKit's runs at the device rate. */
export class NoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = NOISE_PROCESSOR_NAME;
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private node?: RnnoiseWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private inputProbe?: AnalyserNode;
  private probeTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(private readonly failed: () => void) {}

  async init({ track }: AudioProcessorOptions) {
    const requireActive = () => {
      if (this.destroyed || track.readyState === "ended") {
        throw new Error("Noise processor stopped");
      }
    };
    try {
      requireActive();
      const wasmBinary = await loadWasm();
      requireActive();
      const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
      this.context = context;
      await context.audioWorklet.addModule(workletUrl);
      requireActive();
      if (context.state !== "running") {
        await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 300))]);
      }
      requireActive();
      // A paused context emits silence, which would mute the caller instead of filtering them.
      if (context.state !== "running") throw new SuspendedAudioError("Audio context is paused");
      const node = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
      // The worklet filters one channel; a stereo mic would otherwise publish a silent right side.
      node.channelCount = 1;
      node.channelCountMode = "explicit";
      const destination = context.createMediaStreamDestination();
      node.connect(destination);
      this.node = node;
      this.inputProbe = context.createAnalyser();
      this.connect(track);
      this.processedTrack = destination.stream.getAudioTracks()[0];
      this.watch(context, node);
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  async restart({ track }: AudioProcessorOptions) {
    this.connect(track);
  }

  async destroy() {
    this.destroyed = true;
    clearInterval(this.probeTimer);
    this.source?.disconnect();
    this.node?.destroy();
    this.node?.disconnect();
    this.processedTrack?.stop();
    const context = this.context;
    this.context = undefined;
    this.node = undefined;
    this.source = undefined;
    this.inputProbe = undefined;
    this.processedTrack = undefined;
    await context?.close().catch(() => {});
  }

  private connect(track: MediaStreamTrack) {
    if (!this.context || !this.node || !this.inputProbe) return;
    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(this.node);
    this.source.connect(this.inputProbe);
  }

  // The worklet outputs silence until its WASM is running and forever if that fails, so a
  // mic that hears sound while the output stays at zero falls back to the unfiltered track.
  private watch(context: AudioContext, node: RnnoiseWorkletNode) {
    const outputProbe = context.createAnalyser();
    node.connect(outputProbe);
    const heard = new Float32Array(outputProbe.fftSize);
    const sent = new Float32Array(outputProbe.fftSize);
    let dead = 0;
    this.probeTimer = setInterval(() => {
      outputProbe.getFloatTimeDomainData(sent);
      if (sent.some((sample) => sample !== 0)) {
        clearInterval(this.probeTimer);
        return;
      }
      this.inputProbe?.getFloatTimeDomainData(heard);
      if (heard.some((sample) => sample !== 0) && ++dead >= DEAD_PROBES) {
        clearInterval(this.probeTimer);
        if (!this.destroyed) this.failed();
      }
    }, PROBE_INTERVAL_MS);
  }
}

export function createNoiseProcessor(failed: () => void) {
  return new NoiseProcessor(failed);
}
