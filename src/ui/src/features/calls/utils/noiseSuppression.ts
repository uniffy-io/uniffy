import type { LocalAudioTrack } from "livekit-client";
import type { NoiseProcessor } from "@/features/calls/utils/noiseProcessor";

export const NOISE_PROCESSOR_NAME = "uniffy-noise-suppression";
export const NOISE_SUPPRESSION_FAILURE =
  "Noise suppression stopped. Your microphone still works without it.";

/** The bundled model is the only noise filter, so the browser and OS filters stay off. */
export const MIC_CAPTURE_CONSTRAINTS = { noiseSuppression: false, voiceIsolation: false } as const;

/** Thrown when the browser keeps a new audio context paused until the page gets a click or key press. */
export class SuspendedAudioError extends Error {}

export function noiseSuppressionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "AudioWorkletNode" in window &&
    typeof WebAssembly === "object"
  );
}

/** Serializes processor changes on the live mic track so rapid toggles settle on the latest choice. */
export class NoiseSuppressionController {
  private pending = Promise.resolve();
  private broken = new WeakSet<LocalAudioTrack>();
  private retry?: () => void;
  private disposed = false;
  private initializing?: NoiseProcessor;

  constructor(
    private readonly wanted: () => boolean,
    private readonly failed: () => void,
  ) {}

  sync(track: LocalAudioTrack | undefined): Promise<void> {
    const operation = this.pending.then(async () => {
      if (!track || this.inactive(track)) return;
      // Turning suppression off clears earlier failures, so turning it back on tries again.
      if (!this.wanted()) this.broken = new WeakSet();
      const wanted = this.wanted() && noiseSuppressionSupported() && !this.broken.has(track);
      const active = track.getProcessor()?.name === NOISE_PROCESSOR_NAME;
      if (wanted === active) return;
      if (!wanted) {
        await this.release(track);
        return;
      }
      try {
        const { createNoiseProcessor } = await import("@/features/calls/utils/noiseProcessor");
        if (this.inactive(track)) return;
        const processor = createNoiseProcessor(() => this.fail(track));
        this.initializing = processor;
        await track.setProcessor(processor);
        if (this.inactive(track)) track.stop();
      } catch (error) {
        if (this.inactive(track)) return;
        if (error instanceof SuspendedAudioError) this.retryOnInteraction(track);
        else this.fail(track);
      } finally {
        this.initializing = undefined;
      }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  dispose() {
    this.disposed = true;
    this.retry?.();
    void this.initializing?.destroy();
  }

  private inactive(track: LocalAudioTrack) {
    return this.disposed || track.mediaStreamTrack.readyState === "ended";
  }

  // LiveKit drops the processor before it re-applies the mic constraints, so a rejection there
  // leaves the sender on the stopped processed track. Reopening the mic swaps a live one in.
  private async release(track: LocalAudioTrack) {
    try {
      await track.stopProcessor();
    } catch {
      if (this.inactive(track)) return;
      try {
        await track.restartTrack();
        if (this.disposed) track.stop();
      } catch {
        if (!this.disposed) this.failed();
      }
    }
  }

  private fail(track: LocalAudioTrack) {
    if (this.disposed || this.broken.has(track)) return;
    this.broken.add(track);
    void this.sync(track);
    this.failed();
  }

  private retryOnInteraction(track: LocalAudioTrack) {
    this.retry?.();
    const resume = () => {
      this.retry?.();
      void this.sync(track);
    };
    const options = { capture: true, once: true };
    window.addEventListener("pointerdown", resume, options);
    window.addEventListener("keydown", resume, options);
    this.retry = () => {
      window.removeEventListener("pointerdown", resume, options);
      window.removeEventListener("keydown", resume, options);
      this.retry = undefined;
    };
  }
}
