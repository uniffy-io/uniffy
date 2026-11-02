import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioProcessorOptions } from "livekit-client";
import { createNoiseProcessor } from "@/features/calls/utils/noiseProcessor";
import { SuspendedAudioError } from "@/features/calls/utils/noiseSuppression";

const audio = vi.hoisted(() => ({
  contexts: [] as FakeContext[],
  startState: "running" as AudioContextState,
  input: 0,
  output: 0,
  moduleReady: undefined as Promise<void> | undefined,
}));

interface FakeContext {
  options: AudioContextOptions;
  state: AudioContextState;
  sources: { track: unknown; disconnect: ReturnType<typeof vi.fn> }[];
  processed: { stop: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
}

vi.mock("@sapphi-red/web-noise-suppressor", () => ({
  loadRnnoise: vi.fn(async () => new ArrayBuffer(8)),
  RnnoiseWorkletNode: class {
    channelCount = 2;
    channelCountMode = "max";
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
  },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function probe(level: () => number) {
  return {
    fftSize: 4,
    getFloatTimeDomainData: (samples: Float32Array) => samples.fill(level()),
  };
}

class AudioContextStub implements FakeContext {
  state: AudioContextState = audio.startState;
  sources: FakeContext["sources"] = [];
  processed = { stop: vi.fn() };
  close = vi.fn(async () => {
    this.state = "closed";
  });
  audioWorklet = { addModule: vi.fn(async () => audio.moduleReady) };
  private analysers = 0;
  constructor(public options: AudioContextOptions) {
    audio.contexts.push(this);
  }
  resume = vi.fn(async () => {});
  createMediaStreamDestination() {
    return { stream: { getAudioTracks: () => [this.processed] } };
  }
  createMediaStreamSource(stream: { tracks: unknown[] }) {
    const source = { track: stream.tracks[0], connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source);
    return source;
  }
  createAnalyser() {
    // The first analyser listens to the mic, the second to the model output.
    return this.analysers++ === 0 ? probe(() => audio.input) : probe(() => audio.output);
  }
}

const options = (track: unknown) => ({ track }) as unknown as AudioProcessorOptions;

describe("noise processor", () => {
  beforeEach(() => {
    audio.contexts = [];
    audio.startState = "running";
    audio.input = 0;
    audio.output = 0;
    audio.moduleReady = undefined;
    vi.stubGlobal("AudioContext", AudioContextStub);
    vi.stubGlobal(
      "MediaStream",
      class {
        constructor(public tracks: unknown[]) {}
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("filters the mic at 48 kHz as a single channel", async () => {
    const processor = createNoiseProcessor(vi.fn());
    await processor.init(options("mic-a"));
    const [context] = audio.contexts;
    expect(context.options.sampleRate).toBe(48_000);
    expect(context.sources[0].track).toBe("mic-a");
    expect(processor.processedTrack).toBe(context.processed);
    const node = (
      processor as unknown as { node: { channelCount: number; channelCountMode: string } }
    ).node;
    expect(node.channelCount).toBe(1);
    expect(node.channelCountMode).toBe("explicit");
    await processor.destroy();
  });

  it("swaps only the mic source on a device change", async () => {
    const processor = createNoiseProcessor(vi.fn());
    await processor.init(options("mic-a"));
    const processed = processor.processedTrack;
    await processor.restart(options("mic-b"));
    const [context] = audio.contexts;
    expect(audio.contexts).toHaveLength(1);
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(context.sources[1].track).toBe("mic-b");
    expect(processor.processedTrack).toBe(processed);
    await processor.destroy();
  });

  it("refuses a paused context instead of publishing silence", async () => {
    audio.startState = "suspended";
    const processor = createNoiseProcessor(vi.fn());
    await expect(processor.init(options("mic-a"))).rejects.toBeInstanceOf(SuspendedAudioError);
    expect(audio.contexts[0].close).toHaveBeenCalledOnce();
    expect(processor.processedTrack).toBeUndefined();
  });

  it("reports failure when the mic hears sound but the model stays silent", async () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const processor = createNoiseProcessor(failed);
    await processor.init(options("mic-a"));
    audio.input = 0.2;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failed).toHaveBeenCalledOnce();
    await processor.destroy();
  });

  it("stays quiet while the model produces audio or the mic is muted", async () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const processor = createNoiseProcessor(failed);
    await processor.init(options("mic-a"));
    await vi.advanceTimersByTimeAsync(5_000);
    audio.input = 0.2;
    audio.output = 0.1;
    await vi.advanceTimersByTimeAsync(5_000);
    audio.output = 0;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failed).not.toHaveBeenCalled();
    await processor.destroy();
  });

  it("releases the context and processed track on destroy", async () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const processor = createNoiseProcessor(failed);
    await processor.init(options("mic-a"));
    const [context] = audio.contexts;
    await processor.destroy();
    audio.input = 0.2;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.processed.stop).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it.each(["destroy", "ended"])("cancels pending module setup after %s", async (reason) => {
    const loaded = deferred();
    audio.moduleReady = loaded.promise;
    const processor = createNoiseProcessor(vi.fn());
    const track = { readyState: "live" };
    const pending = processor.init(options(track));
    await vi.waitFor(() => expect(audio.contexts).toHaveLength(1));
    if (reason === "destroy") await processor.destroy();
    else track.readyState = "ended";
    const rejected = expect(pending).rejects.toThrow("Noise processor stopped");
    loaded.resolve();
    await rejected;
    expect(audio.contexts[0].close).toHaveBeenCalledOnce();
    expect(audio.contexts[0].sources).toHaveLength(0);
    expect(processor.processedTrack).toBeUndefined();
  });

  it("never starts a processor destroyed before initialization", async () => {
    const processor = createNoiseProcessor(vi.fn());
    await processor.destroy();
    await expect(processor.init(options("mic"))).rejects.toThrow("Noise processor stopped");
    expect(audio.contexts).toHaveLength(0);
  });
});
