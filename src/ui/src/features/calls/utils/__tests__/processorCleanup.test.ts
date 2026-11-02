import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessorWrapper } from "@livekit/track-processors";
import { Track } from "livekit-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("processor initialization cleanup", () => {
  it.each([
    { modern: false, cancel: false },
    { modern: true, cancel: false },
    { modern: false, cancel: true },
    { modern: true, cancel: true },
  ])(
    "releases partial resources with modern=$modern and cancel=$cancel",
    async ({ modern, cancel }) => {
      vi.useFakeTimers();
      const stop = vi.fn();
      const removeChild = vi.fn();
      const close = vi.fn();
      class VideoElement {}
      const canvas = {
        style: {},
        dataset: {},
        parentNode: { removeChild },
        getContext: () => ({}),
        captureStream: () => ({ getTracks: () => [{ stop }] }),
      };
      vi.stubGlobal("HTMLVideoElement", VideoElement);
      vi.stubGlobal("OffscreenCanvas", class {});
      vi.stubGlobal("document", {
        querySelector: () => null,
        createElement: () => canvas,
        body: { appendChild: vi.fn() },
      });
      vi.stubGlobal(
        "MediaStreamTrackProcessor",
        modern
          ? class {
              writableControl = { close };
            }
          : undefined,
      );
      vi.stubGlobal(
        "MediaStreamTrackGenerator",
        modern
          ? class {
              stop = stop;
            }
          : undefined,
      );
      let finish!: () => void;
      const transformer = {
        init: cancel
          ? vi.fn(
              () =>
                new Promise<void>((resolve) => {
                  finish = resolve;
                }),
            )
          : vi.fn().mockRejectedValue(new Error("model unavailable")),
        destroy: vi.fn(),
        restart: vi.fn(),
        transform: vi.fn(),
        update: vi.fn(),
      };
      const processor = new ProcessorWrapper(transformer, "cleanup-test");
      const initialization = processor.init({
        kind: Track.Kind.Video,
        track: { getSettings: () => ({ width: 640, height: 480 }) } as MediaStreamTrack,
        element: new VideoElement() as HTMLVideoElement,
      });
      const rejection = expect(initialization).rejects.toThrow(
        cancel ? "Processor stopped" : "model unavailable",
      );
      await vi.advanceTimersByTimeAsync(20);
      if (cancel) {
        await processor.destroy();
        expect(stop).toHaveBeenCalledOnce();
        expect(transformer.destroy).toHaveBeenCalledOnce();
        finish();
      }
      await rejection;
      const cleanups = cancel ? 2 : 1;
      expect(transformer.destroy).toHaveBeenCalledTimes(cleanups);
      expect(stop).toHaveBeenCalledTimes(cleanups);
      if (modern) expect(close).toHaveBeenCalledTimes(cleanups);
      else expect(removeChild).toHaveBeenCalledWith(canvas);
      await processor.destroy();
      expect(transformer.destroy).toHaveBeenCalledTimes(cleanups);
    },
  );
});
