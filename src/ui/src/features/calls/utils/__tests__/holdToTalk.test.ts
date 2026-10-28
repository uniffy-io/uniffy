import { describe, expect, it, vi } from "vitest";
import { createHoldToTalk } from "@/features/calls/utils/holdToTalk";

describe("hold to talk", () => {
  it("mutes after an activation that finishes after key release", async () => {
    let finish!: () => void;
    const capture = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const setEnabled = vi.fn(async (enabled: boolean) => {
      if (enabled) await capture;
    });
    const hold = createHoldToTalk(setEnabled);
    void hold.press(true);
    const released = hold.release();
    await Promise.resolve();
    expect(setEnabled.mock.calls).toEqual([[true]]);
    finish();
    await released;
    expect(setEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it("does not alter an already live microphone", async () => {
    const setEnabled = vi.fn(async () => {});
    const hold = createHoldToTalk(setEnabled);
    await hold.press(false);
    await hold.release();
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("ignores repeats and duplicate release events", async () => {
    const setEnabled = vi.fn(async () => {});
    const hold = createHoldToTalk(setEnabled);
    void hold.press(true);
    void hold.press(true);
    void hold.release();
    await hold.release();
    expect(setEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it("still releases after capture rejects and accepts the next press", async () => {
    const setEnabled = vi.fn(async () => {}).mockRejectedValueOnce(new Error("denied"));
    const hold = createHoldToTalk(setEnabled);
    void hold.press(true);
    await hold.release();
    void hold.press(true);
    await hold.release();
    expect(setEnabled.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
