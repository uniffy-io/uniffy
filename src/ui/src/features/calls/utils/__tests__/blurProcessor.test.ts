import { afterEach, describe, expect, it, vi } from "vitest";
import { BlurTransformer } from "@/features/calls/utils/blurProcessor";
import {
  DEFAULT_BLUR_STRENGTH,
  activeBlurRadius,
  setActiveBlurStrength,
} from "@/features/calls/utils/blurStrength";

describe("blur frame privacy", () => {
  afterEach(() => {
    setActiveBlurStrength(DEFAULT_BLUR_STRENGTH);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(failure?: "mask" | "segment" | "render") {
    const failed = vi.fn();
    const ready = vi.fn();
    const transformer = new BlurTransformer(failed, ready);
    const canvas = { width: 0, height: 0 };
    const result = {
      categoryMask: failure === "mask" ? undefined : { getAsWebGLTexture: vi.fn() },
      close: vi.fn(),
    };
    transformer.canvas = canvas as OffscreenCanvas;
    const gl = {
      setBlurRadius: vi.fn(),
      updateMask: vi.fn(),
      renderFrame: vi.fn(() => {
        if (failure === "render") throw new Error("context lost");
      }),
    };
    transformer.gl = gl as unknown as NonNullable<typeof transformer.gl>;
    transformer.imageSegmenter = {
      segmentForVideo: vi.fn((_frame, _time, callback) => {
        if (failure === "segment") throw new Error("GPU unavailable");
        callback(result);
      }),
    } as unknown as NonNullable<typeof transformer.imageSegmenter>;
    const frame = {
      codedWidth: 640,
      codedHeight: 480,
      displayWidth: 640,
      displayHeight: 480,
      timestamp: 123,
      close: vi.fn(),
      clone: vi.fn(),
    };
    const controller = { enqueue: vi.fn() };
    vi.stubGlobal(
      "VideoFrame",
      class {
        constructor(public source: unknown) {}
      },
    );
    return { transformer, failed, ready, frame, controller, result, canvas, gl };
  }

  it("emits processed pixels from first frame, never a camera clone", async () => {
    const { transformer, frame, controller, canvas, result, ready } = setup();
    await transformer.transform(
      frame as unknown as VideoFrame,
      controller as unknown as TransformStreamDefaultController<VideoFrame>,
    );
    expect(controller.enqueue).toHaveBeenCalledOnce();
    expect(controller.enqueue.mock.calls[0][0].source).toBe(canvas);
    expect(frame.clone).not.toHaveBeenCalled();
    expect(frame.close).toHaveBeenCalledOnce();
    expect(result.close).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
  });

  it.each(["mask", "segment", "render"] as const)(
    "emits no raw fallback after %s failure",
    async (failure) => {
      const { transformer, frame, controller, failed, ready } = setup(failure);
      await transformer.transform(
        frame as unknown as VideoFrame,
        controller as unknown as TransformStreamDefaultController<VideoFrame>,
      );
      expect(controller.enqueue).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledOnce();
      expect(frame.close).toHaveBeenCalledOnce();
      await transformer.transform(
        frame as unknown as VideoFrame,
        controller as unknown as TransformStreamDefaultController<VideoFrame>,
      );
      expect(controller.enqueue).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledOnce();
    },
  );

  it("caps inference on a 60 FPS stream and closes skipped frames", async () => {
    const { transformer, frame, controller } = setup();
    const clock = vi.spyOn(performance, "now");
    for (let index = 0; index < 60; index++) {
      clock.mockReturnValue((index * 1000) / 60);
      await transformer.transform(
        frame as unknown as VideoFrame,
        controller as unknown as TransformStreamDefaultController<VideoFrame>,
      );
    }
    expect(controller.enqueue.mock.calls.length).toBeLessThanOrEqual(24);
    expect(controller.enqueue.mock.calls.length).toBeGreaterThan(0);
    expect(frame.close).toHaveBeenCalledTimes(60);
  });

  it("applies a strength change to the running processor once", async () => {
    const { transformer, frame, controller, gl } = setup();
    const clock = vi.spyOn(performance, "now");
    const run = async (at: number) => {
      clock.mockReturnValue(at);
      await transformer.transform(
        frame as unknown as VideoFrame,
        controller as unknown as TransformStreamDefaultController<VideoFrame>,
      );
    };
    await run(0);
    expect(gl.setBlurRadius).not.toHaveBeenCalled();
    setActiveBlurStrength("light");
    await run(100);
    await run(200);
    expect(gl.setBlurRadius).toHaveBeenCalledOnce();
    expect(gl.setBlurRadius).toHaveBeenCalledWith(activeBlurRadius());
    expect(controller.enqueue).toHaveBeenCalledTimes(3);
  });
});
