import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAudioTrack } from "livekit-client";
import {
  NOISE_PROCESSOR_NAME,
  NoiseSuppressionController,
  SuspendedAudioError,
} from "@/features/calls/utils/noiseSuppression";

const state = vi.hoisted(() => ({
  initError: undefined as Error | undefined,
  failed: undefined as (() => void) | undefined,
  destroy: vi.fn(async () => {}),
}));
vi.mock("@/features/calls/utils/noiseProcessor", () => ({
  createNoiseProcessor: (failed: () => void) => {
    state.failed = failed;
    return { name: "uniffy-noise-suppression", destroy: state.destroy };
  },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeTrack() {
  const track = {
    processor: undefined as { name: string } | undefined,
    mediaStreamTrack: { readyState: "live" },
    getProcessor: () => track.processor,
    setProcessor: vi.fn(async (processor: { name: string }) => {
      if (state.initError) throw state.initError;
      track.processor = processor;
    }),
    stopProcessor: vi.fn(async () => {
      track.processor = undefined;
    }),
    restartTrack: vi.fn(async () => {}),
    stop: vi.fn(() => {
      track.mediaStreamTrack.readyState = "ended";
      if (track.processor) void state.destroy();
    }),
  };
  return track;
}

function setup(wanted = true) {
  const preference = { wanted };
  const failed = vi.fn();
  const controller = new NoiseSuppressionController(() => preference.wanted, failed);
  const track = fakeTrack();
  const sync = () => controller.sync(track as unknown as LocalAudioTrack);
  return { preference, failed, controller, track, sync };
}

describe("noise suppression controller", () => {
  beforeEach(() => {
    state.initError = undefined;
    state.failed = undefined;
    state.destroy.mockClear();
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { isSecureContext: true, AudioWorkletNode: class {} }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("attaches the model when wanted and removes it when turned off", async () => {
    const { preference, track, sync } = setup();
    await sync();
    expect(track.processor?.name).toBe(NOISE_PROCESSOR_NAME);
    preference.wanted = false;
    await sync();
    expect(track.stopProcessor).toHaveBeenCalledOnce();
    expect(track.processor).toBeUndefined();
  });

  it("settles on the latest choice after rapid toggles", async () => {
    const { preference, track, sync } = setup();
    const first = sync();
    preference.wanted = false;
    await Promise.all([first, sync()]);
    expect(track.setProcessor).not.toHaveBeenCalled();
    expect(track.processor).toBeUndefined();
  });

  it("keeps the raw mic and reports once when the model fails to start", async () => {
    const { preference, failed, track, sync } = setup();
    state.initError = new Error("wasm blocked");
    await sync();
    await sync();
    expect(failed).toHaveBeenCalledOnce();
    expect(track.setProcessor).toHaveBeenCalledOnce();
    state.initError = undefined;
    preference.wanted = false;
    await sync();
    preference.wanted = true;
    await sync();
    expect(track.processor?.name).toBe(NOISE_PROCESSOR_NAME);
  });

  it("falls back to the raw mic when a running model goes silent", async () => {
    const { failed, track, sync } = setup();
    await sync();
    state.failed?.();
    await sync();
    expect(track.stopProcessor).toHaveBeenCalledOnce();
    expect(track.processor).toBeUndefined();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("reopens the mic when LiveKit cannot restore the raw track", async () => {
    const { preference, failed, track, sync } = setup();
    await sync();
    track.stopProcessor.mockImplementationOnce(async () => {
      track.processor = undefined;
      throw new Error("Cannot satisfy constraints");
    });
    preference.wanted = false;
    await sync();
    expect(track.restartTrack).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    track.restartTrack.mockRejectedValueOnce(new Error("device gone"));
    preference.wanted = true;
    await sync();
    track.stopProcessor.mockRejectedValueOnce(new Error("Cannot satisfy constraints"));
    preference.wanted = false;
    await sync();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("waits for a page interaction when the browser keeps audio paused", async () => {
    const { failed, track, sync } = setup();
    state.initError = new SuspendedAudioError("paused");
    await sync();
    expect(failed).not.toHaveBeenCalled();
    state.initError = undefined;
    window.dispatchEvent(new Event("pointerdown"));
    await sync();
    expect(track.processor?.name).toBe(NOISE_PROCESSOR_NAME);
  });

  it("stops waiting for interaction after dispose", async () => {
    const { controller, track, sync } = setup();
    state.initError = new SuspendedAudioError("paused");
    await sync();
    controller.dispose();
    state.initError = undefined;
    window.dispatchEvent(new Event("keydown"));
    await sync();
    expect(track.setProcessor).toHaveBeenCalledOnce();
  });

  it("destroys setup that finishes after leaving the call", async () => {
    const { controller, track, sync, failed } = setup();
    const started = deferred();
    const finish = deferred();
    track.setProcessor.mockImplementationOnce(async (processor) => {
      started.resolve();
      await finish.promise;
      track.processor = processor;
    });
    const pending = sync();
    await started.promise;
    controller.dispose();
    track.stop();
    expect(state.destroy).toHaveBeenCalledOnce();
    finish.resolve();
    await pending;
    expect(track.stop).toHaveBeenCalledTimes(2);
    expect(state.destroy).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it("does not install interaction retries after disposed setup fails", async () => {
    const { controller, track, sync } = setup();
    const started = deferred();
    const finish = deferred();
    track.setProcessor.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      throw new SuspendedAudioError("paused");
    });
    const listener = vi.spyOn(window, "addEventListener");
    const pending = sync();
    await started.promise;
    controller.dispose();
    finish.resolve();
    await pending;
    expect(listener).not.toHaveBeenCalled();
    listener.mockRestore();
  });

  it.each(["dispose", "revocation"])("does not reopen the mic after %s", async (reason) => {
    const { controller, preference, track, sync } = setup();
    await sync();
    const started = deferred();
    const finish = deferred();
    track.stopProcessor.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      track.processor = undefined;
      throw new Error("Cannot satisfy constraints");
    });
    preference.wanted = false;
    const pending = sync();
    await started.promise;
    if (reason === "dispose") controller.dispose();
    track.stop();
    finish.resolve();
    await pending;
    expect(track.restartTrack).not.toHaveBeenCalled();
  });

  it("never loads the model where AudioWorklet is unavailable", async () => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { isSecureContext: false }));
    const { track, sync } = setup();
    await sync();
    expect(track.setProcessor).not.toHaveBeenCalled();
  });
});
