import { describe, expect, it, vi } from "vitest";
import { createCameraContinuity } from "@features/calls/cameraContinuity";

describe("camera continuity", () => {
  it("restores a previously enabled camera after a delayed background stop", async () => {
    let finishStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    const device = {
      isCameraEnabled: true,
      setCameraEnabled: vi.fn(async (enabled: boolean) => {
        if (!enabled) await stopped;
        device.isCameraEnabled = enabled;
      }),
    };
    const changed = vi.fn();
    const continuity = createCameraContinuity(device, changed, vi.fn());
    const background = continuity.update(false);
    await Promise.resolve();
    const foreground = continuity.update(true);
    finishStop();
    await Promise.all([background, foreground]);
    expect(device.isCameraEnabled).toBe(true);
    expect(changed.mock.calls).toEqual([[false], [true]]);
  });
  it("never enables a camera that was off", async () => {
    const device = { isCameraEnabled: false, setCameraEnabled: vi.fn() };
    const continuity = createCameraContinuity(device, vi.fn(), vi.fn());
    await continuity.update(false);
    await continuity.update(true);
    expect(device.setCameraEnabled).not.toHaveBeenCalled();
  });
  it("does not restore after leaving or after an explicit camera choice", async () => {
    for (const cancel of ["dispose", "cancelRestore"] as const) {
      const device = {
        isCameraEnabled: true,
        setCameraEnabled: vi.fn(async (enabled: boolean) => {
          device.isCameraEnabled = enabled;
        }),
      };
      const continuity = createCameraContinuity(device, vi.fn(), vi.fn());
      await continuity.update(false);
      continuity[cancel]();
      await continuity.update(true);
      expect(device.isCameraEnabled).toBe(false);
    }
  });
  it("reports a failed foreground restore without retrying denied permissions", async () => {
    const error = new Error("denied");
    const device = {
      isCameraEnabled: true,
      setCameraEnabled: vi.fn(async (enabled: boolean) => {
        if (enabled) throw error;
        device.isCameraEnabled = enabled;
      }),
    };
    const failed = vi.fn();
    const continuity = createCameraContinuity(device, vi.fn(), failed);
    await continuity.update(false);
    await continuity.update(true);
    await continuity.update(true);
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(device.setCameraEnabled).toHaveBeenCalledTimes(2);
  });
});
