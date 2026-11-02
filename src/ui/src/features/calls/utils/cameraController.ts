import { Track, type LocalParticipant, type LocalVideoTrack } from "livekit-client";
import { createCameraTrack, type CameraOptions } from "@/features/calls/utils/cameraTrack";

export class CameraController {
  enabled = false;
  private generation = 0;
  private pending = Promise.resolve();
  private abort?: AbortController;
  private track?: LocalVideoTrack;
  private disposed = false;

  constructor(
    private readonly participant: LocalParticipant,
    private readonly failed: () => void,
  ) {}

  set(enabled: boolean, options: CameraOptions): Promise<void> {
    this.enabled = enabled;
    const generation = ++this.generation;
    this.abort?.abort();
    this.track?.stop();
    const operation = this.pending.then(async () => {
      if (this.track) {
        await this.participant.unpublishTrack(this.track);
        this.track = undefined;
      }
      if (this.disposed || generation !== this.generation || !enabled) return;
      const abort = new AbortController();
      this.abort = abort;
      let track: LocalVideoTrack | undefined;
      try {
        track = await createCameraTrack(options, abort.signal, () => {
          if (!this.disposed && generation === this.generation) {
            void this.set(false, options);
            this.failed();
          }
        });
        if (this.disposed || generation !== this.generation) return;
        this.track = track;
        await this.participant.publishTrack(track, { source: Track.Source.Camera });
        if (this.disposed || generation !== this.generation) {
          await this.participant.unpublishTrack(track);
          if (this.track === track) this.track = undefined;
        }
      } catch (error) {
        track?.stop();
        if (track) {
          await this.participant.unpublishTrack(track);
          if (this.track === track) this.track = undefined;
        }
        if (!this.disposed && generation === this.generation) {
          this.enabled = false;
          throw error;
        }
      } finally {
        if (this.disposed || generation !== this.generation) track?.stop();
      }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  dispose() {
    this.disposed = true;
    this.enabled = false;
    this.generation++;
    this.abort?.abort();
    this.track?.stop();
  }
}
