import { describe, it, expect } from "vitest";
import { TranscodeStatus } from "@uniffy/proto/files/v1/files_pb";
import { getDownloadGateState, isTranscodePending } from "@/features/files/utils/transcodeGate";

describe("isTranscodePending", () => {
  it("is true only while the worker still owns the bytes", () => {
    expect(isTranscodePending(TranscodeStatus.PENDING)).toBe(true);
    expect(isTranscodePending(TranscodeStatus.PROCESSING)).toBe(true);
    expect(isTranscodePending(TranscodeStatus.COMPLETED)).toBe(false);
    expect(isTranscodePending(TranscodeStatus.FAILED)).toBe(false);
    expect(isTranscodePending(TranscodeStatus.NOT_NEEDED)).toBe(false);
    expect(isTranscodePending(undefined)).toBe(false);
  });
});

describe("getDownloadGateState", () => {
  it("returns enabled when status is undefined", () => {
    const state = getDownloadGateState(undefined);
    expect(state.disabled).toBe(false);
    expect(state.tooltip).toBeNull();
    expect(state.failed).toBe(false);
  });

  it("returns enabled when status is NOT_NEEDED", () => {
    const state = getDownloadGateState(TranscodeStatus.NOT_NEEDED);
    expect(state.disabled).toBe(false);
    expect(state.tooltip).toBeNull();
  });

  it("returns enabled when status is COMPLETED", () => {
    const state = getDownloadGateState(TranscodeStatus.COMPLETED);
    expect(state.disabled).toBe(false);
    expect(state.tooltip).toBeNull();
  });

  it("disables download with tooltip while PENDING", () => {
    const state = getDownloadGateState(TranscodeStatus.PENDING);
    expect(state.disabled).toBe(true);
    expect(state.tooltip).toMatch(/Optimising/);
    expect(state.failed).toBe(false);
  });

  it("disables download with tooltip while PROCESSING", () => {
    const state = getDownloadGateState(TranscodeStatus.PROCESSING);
    expect(state.disabled).toBe(true);
    expect(state.tooltip).toMatch(/Optimising/);
  });

  it("keeps download enabled but flags failure when FAILED", () => {
    const state = getDownloadGateState(TranscodeStatus.FAILED);
    expect(state.disabled).toBe(false);
    expect(state.failed).toBe(true);
    expect(state.tooltip).toMatch(/Optimisation failed/);
  });
});
