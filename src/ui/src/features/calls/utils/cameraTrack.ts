import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";

export const BLUR_FAILURE =
  "Background blur failed. Camera is off. Retry or turn blur off to use your camera.";
export const BLUR_UNSUPPORTED =
  "Background blur is unavailable in this browser. Camera stays off while blur is selected.";

export class BackgroundBlurError extends Error {}

export interface CameraOptions {
  deviceId: string | null;
  blur: boolean;
}

export async function createCameraTrack(
  options: CameraOptions,
  signal: AbortSignal,
  onFailure: () => void,
): Promise<LocalVideoTrack> {
  signal.throwIfAborted();
  let track: LocalVideoTrack | undefined;
  let processor:
    | ReturnType<typeof import("@/features/calls/utils/blurProcessor").createBlurProcessor>
    | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = reject;
  });
  const stop = (error: Error) => {
    stopped = true;
    track?.stop();
    interrupt(error);
  };
  const abort = () => stop(new DOMException("Camera stopped", "AbortError"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    const module = options.blur
      ? await Promise.race([
          import("@/features/calls/utils/blurProcessor").catch(() => {
            throw new BackgroundBlurError(BLUR_FAILURE);
          }),
          interrupted,
        ])
      : null;
    if (module && !module.blurSupported()) throw new BackgroundBlurError(BLUR_UNSUPPORTED);
    const capture = createLocalVideoTrack({ deviceId: options.deviceId ?? undefined }).then(
      (value) => {
        if (stopped) value.stop();
        return value;
      },
    );
    track = await Promise.race([capture, interrupted]);
    const camera = track;
    if (module) {
      let rejectReady: (error: Error) => void = () => {};
      let resolveReady: () => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      processor = module.createBlurProcessor(() => {
        if (stopped) return;
        stopped = true;
        camera.stop();
        rejectReady(new BackgroundBlurError(BLUR_FAILURE));
        onFailure();
      }, resolveReady);
      try {
        timer = setTimeout(() => stop(new BackgroundBlurError(BLUR_FAILURE)), 10_000);
        const initialized = camera.setProcessor(processor).then(() => {
          // SDK attaches the processor only after initialization completes.
          if (stopped) camera.stop();
        });
        await Promise.race([Promise.all([initialized, ready]), interrupted]);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new BackgroundBlurError(BLUR_FAILURE);
      }
    }
    signal.throwIfAborted();
    if (stopped) throw new BackgroundBlurError(BLUR_FAILURE);
    return track;
  } catch (error) {
    stopped = true;
    const attached = track?.getProcessor();
    track?.stop();
    if (processor && attached !== processor) await processor.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
