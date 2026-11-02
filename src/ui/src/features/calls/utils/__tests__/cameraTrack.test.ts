import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalVideoTrack } from "livekit-client";
import { createCameraTrack, BackgroundBlurError } from "@/features/calls/utils/cameraTrack";

const state = vi.hoisted(() => ({
  supported: true,
  ready: () => {},
  failed: () => {},
  destroy: vi.fn(),
}));
vi.mock("livekit-client", () => ({ createLocalVideoTrack: vi.fn() }));
vi.mock("@/features/calls/utils/blurProcessor", () => ({
  blurSupported: () => state.supported,
  createBlurProcessor: (failed: () => void, ready: () => void) => {
    state.ready = ready;
    state.failed = failed;
    return { destroy: state.destroy };
  },
}));

function setup() {
  const track = {
    stop: vi.fn(),
    getProcessor: vi.fn(),
    setProcessor: vi.fn().mockResolvedValue(undefined),
    mediaStreamTrack: { stop: vi.fn() },
  };
  vi.mocked(createLocalVideoTrack).mockResolvedValue(
    track as unknown as Awaited<ReturnType<typeof createLocalVideoTrack>>,
  );
  const abort = new AbortController();
  const failed = vi.fn();
  return { track, abort, failed };
}

describe("prepared camera capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.supported = true;
  });
  afterEach(() => vi.useRealTimers());

  it("waits for first processed frame before returning track", async () => {
    const { track, abort, failed } = setup();
    let completed = false;
    const prepared = createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed).then(
      (value) => {
        completed = true;
        return value;
      },
    );
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalled());
    expect(completed).toBe(false);
    state.ready();
    expect(await prepared).toBe(track);
    expect(failed).not.toHaveBeenCalled();
  });

  it("never opens camera when selected blur is unsupported", async () => {
    const { abort, failed } = setup();
    state.supported = false;
    await expect(
      createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed),
    ).rejects.toBeInstanceOf(BackgroundBlurError);
    expect(createLocalVideoTrack).not.toHaveBeenCalled();
  });

  it("stops camera and destroys partial processor on initialization failure", async () => {
    const { track, abort, failed } = setup();
    track.setProcessor.mockRejectedValue(new Error("model fetch failed"));
    await expect(
      createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed),
    ).rejects.toBeInstanceOf(BackgroundBlurError);
    expect(track.stop).toHaveBeenCalled();
    expect(state.destroy).toHaveBeenCalled();
  });

  it("cancels waiting for first frame when preview closes", async () => {
    const { track, abort, failed } = setup();
    const prepared = createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed);
    const rejection = expect(prepared).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalled());
    abort.abort();
    await rejection;
    expect(track.stop).toHaveBeenCalled();
  });

  it("cancels stalled initialization and stops a processor attached later", async () => {
    const { track, abort, failed } = setup();
    let finish!: () => void;
    track.setProcessor.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const prepared = createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed);
    const rejection = expect(prepared).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalled());
    abort.abort();
    await rejection;
    track.stop.mockClear();
    finish();
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    state.failed();
    expect(failed).not.toHaveBeenCalled();
  });

  it("times out stalled initialization without waiting for its result", async () => {
    vi.useFakeTimers();
    const { track, abort, failed } = setup();
    track.setProcessor.mockReturnValue(new Promise(() => {}));
    const prepared = createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed);
    const rejection = expect(prepared).rejects.toBeInstanceOf(BackgroundBlurError);
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(track.stop).toHaveBeenCalled();
  });

  it("cancels pending capture and stops camera if permission arrives later", async () => {
    const { track, abort, failed } = setup();
    let finish!: () => void;
    vi.mocked(createLocalVideoTrack).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve(track as unknown as Awaited<ReturnType<typeof createLocalVideoTrack>>);
        }),
    );
    const prepared = createCameraTrack({ blur: false, deviceId: null }, abort.signal, failed);
    const rejection = expect(prepared).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    await rejection;
    finish();
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("stops an already prepared camera on later processing failure", async () => {
    const { track, abort, failed } = setup();
    const prepared = createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed);
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalled());
    state.ready();
    await prepared;
    state.failed();
    expect(track.stop).toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("keeps camera off when no processed frame arrives", async () => {
    vi.useFakeTimers();
    const { track, abort, failed } = setup();
    const prepared = createCameraTrack({ blur: true, deviceId: null }, abort.signal, failed);
    const rejection = expect(prepared).rejects.toBeInstanceOf(BackgroundBlurError);
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(track.stop).toHaveBeenCalled();
  });

  it("returns raw camera only when blur is off", async () => {
    const { track, abort, failed } = setup();
    expect(await createCameraTrack({ blur: false, deviceId: "chosen" }, abort.signal, failed)).toBe(
      track,
    );
    expect(createLocalVideoTrack).toHaveBeenCalledWith({ deviceId: "chosen" });
    expect(track.setProcessor).not.toHaveBeenCalled();
  });
});
