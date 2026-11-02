import {
  BackgroundTransformer,
  ProcessorWrapper,
  supportsBackgroundProcessors,
} from "@livekit/track-processors";
import { activeBlurRadius } from "@/features/calls/utils/blurStrength";

export function blurSupported(): boolean {
  return supportsBackgroundProcessors();
}

// Upstream's transform emits a raw startup frame. Every emitted frame here must have a mask.
export class BlurTransformer extends BackgroundTransformer {
  private nextFrameAt = 0;
  private appliedRadius = activeBlurRadius();

  constructor(
    private readonly failed: () => void,
    private readonly ready: () => void,
  ) {
    super({
      blurRadius: activeBlurRadius(),
      assetPaths: {
        tasksVisionFileSet: "/background-blur/vision-0.10.14",
        modelAssetPath: "/background-blur/selfie_segmenter.tflite",
      },
    });
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    try {
      if (this.isDisabled || !frame.codedWidth || !frame.codedHeight) return;
      const now = performance.now();
      if (now < this.nextFrameAt) return;
      this.nextFrameAt = Math.max(now, this.nextFrameAt + 1000 / 24);
      if (!this.canvas || !this.gl || !this.imageSegmenter) throw new Error("Blur is unavailable");
      const { canvas, gl } = this;
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
      const radius = activeBlurRadius();
      if (radius !== this.appliedRadius) {
        gl.setBlurRadius(radius);
        this.appliedRadius = radius;
      }
      this.imageSegmenter.segmentForVideo(frame, now, (result) => {
        try {
          if (!result.categoryMask) throw new Error("Blur mask is unavailable");
          gl.updateMask(result.categoryMask.getAsWebGLTexture());
          gl.renderFrame(frame);
          controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }));
          this.ready();
        } finally {
          result.close();
        }
      });
    } catch {
      this.isDisabled = true;
      this.failed();
    } finally {
      frame.close();
    }
  }
}

export function createBlurProcessor(failed: () => void, ready: () => void) {
  return new ProcessorWrapper(new BlurTransformer(failed, ready), "uniffy-background-blur", {
    maxFps: 24,
  });
}
