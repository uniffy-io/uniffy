import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalParticipant, LocalVideoTrack } from "livekit-client";
import { CameraController } from "@/features/calls/utils/cameraController";
import { createCameraTrack } from "@/features/calls/utils/cameraTrack";

vi.mock("@/features/calls/utils/cameraTrack", () => ({ createCameraTrack: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const options = { blur: true, deviceId: "camera-a" };
const track = () => ({ stop: vi.fn() }) as unknown as LocalVideoTrack;

describe("camera publication", () => {
  beforeEach(() => vi.clearAllMocks());
  const setup = () => {
    const participant = {
      publishTrack: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    };
    const failed = vi.fn();
    return {
      participant,
      failed,
      camera: new CameraController(participant as unknown as LocalParticipant, failed),
    };
  };

  it("publishes only after camera processing completes", async () => {
    const { camera, participant } = setup();
    const pending = deferred<LocalVideoTrack>();
    vi.mocked(createCameraTrack).mockReturnValue(pending.promise);
    const operation = camera.set(true, options);
    await vi.waitFor(() => expect(createCameraTrack).toHaveBeenCalled());
    expect(participant.publishTrack).not.toHaveBeenCalled();
    const prepared = track();
    pending.resolve(prepared);
    await operation;
    expect(participant.publishTrack).toHaveBeenCalledWith(prepared, { source: "camera" });
  });

  it("stops capture resolving after teardown without publishing", async () => {
    const { camera, participant } = setup();
    const pending = deferred<LocalVideoTrack>();
    vi.mocked(createCameraTrack).mockReturnValue(pending.promise);
    const operation = camera.set(true, options);
    await vi.waitFor(() => expect(createCameraTrack).toHaveBeenCalled());
    camera.dispose();
    expect(vi.mocked(createCameraTrack).mock.calls[0][1].aborted).toBe(true);
    const prepared = track();
    pending.resolve(prepared);
    await operation;
    expect(prepared.stop).toHaveBeenCalled();
    expect(participant.publishTrack).not.toHaveBeenCalled();
  });

  it("removes a track if teardown races publication", async () => {
    const { camera, participant } = setup();
    const publication = deferred<void>();
    const prepared = track();
    vi.mocked(createCameraTrack).mockResolvedValue(prepared);
    participant.publishTrack.mockReturnValue(publication.promise);
    const operation = camera.set(true, options);
    await vi.waitFor(() => expect(participant.publishTrack).toHaveBeenCalled());
    camera.dispose();
    expect(prepared.stop).toHaveBeenCalled();
    publication.resolve();
    await operation;
    expect(participant.unpublishTrack).toHaveBeenCalledWith(prepared);
  });

  it("stops old camera immediately and publishes only latest replacement", async () => {
    const { camera, participant } = setup();
    const first = track();
    vi.mocked(createCameraTrack).mockResolvedValue(first);
    await camera.set(true, options);
    const pending = deferred<LocalVideoTrack>();
    vi.mocked(createCameraTrack).mockReturnValueOnce(pending.promise);
    const replacement = camera.set(true, { ...options, deviceId: "camera-b" });
    expect(first.stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(createCameraTrack).toHaveBeenCalledTimes(2));
    const stop = camera.set(false, options);
    const stale = track();
    pending.resolve(stale);
    await Promise.all([replacement, stop]);
    expect(stale.stop).toHaveBeenCalled();
    expect(participant.publishTrack).toHaveBeenCalledTimes(1);
    expect(camera.enabled).toBe(false);
  });

  it("keeps camera off on initialization failure and allows retry", async () => {
    const { camera, participant } = setup();
    vi.mocked(createCameraTrack).mockRejectedValueOnce(new Error("model unavailable"));
    await expect(camera.set(true, options)).rejects.toThrow("model unavailable");
    expect(camera.enabled).toBe(false);
    expect(participant.publishTrack).not.toHaveBeenCalled();
    vi.mocked(createCameraTrack).mockResolvedValue(track());
    await camera.set(true, options);
    expect(camera.enabled).toBe(true);
  });

  it("removes published camera on processing failure", async () => {
    const { camera, participant, failed } = setup();
    const prepared = track();
    vi.mocked(createCameraTrack).mockResolvedValue(prepared);
    await camera.set(true, options);
    vi.mocked(createCameraTrack).mock.calls[0][2]();
    await vi.waitFor(() => expect(participant.unpublishTrack).toHaveBeenCalledWith(prepared));
    expect(prepared.stop).toHaveBeenCalled();
    expect(camera.enabled).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
  });
});
