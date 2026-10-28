import { describe, expect, it } from "vitest";
import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";
import { callErrorMessage, callAvailabilityMessage } from "@/features/calls/utils/callErrors";

describe("call feedback", () => {
  it("does not label administrative refusal as a network failure", () => {
    expect(
      callErrorMessage({ code: 7, message: "Calls are disabled for this organization" }),
    ).toContain("disabled");
    expect(
      callErrorMessage({ code: 14, message: "Calls are not configured on this deployment" }),
    ).toContain("not configured");
    expect(callErrorMessage({ code: 7, message: "private internal information" })).toContain(
      "permission",
    );
    expect(callErrorMessage(new Error("secret internal information"))).not.toContain("secret");
  });
  it("distinguishes capture cancellation, system blocking and ambiguous refusal", () => {
    expect(callErrorMessage({ name: "AbortError" }, "screen")).toContain("cancelled");
    expect(callErrorMessage({ name: "NotReadableError" }, "screen")).toContain(
      "blocked by your device",
    );
    expect(callErrorMessage({ name: "NotAllowedError" }, "screen")).toContain("If you cancelled");
  });
  it("offers device recovery and distinguishes missing from busy devices", () => {
    expect(callErrorMessage({ name: "NotFoundError" }, "microphone")).toContain("Connect a device");
    expect(callErrorMessage({ name: "NotReadableError" }, "camera")).toContain("Close other apps");
    expect(callErrorMessage({ name: "NotAllowedError" }, "camera")).toContain("settings");
  });
  it("requires a known ready status", () => {
    expect(callAvailabilityMessage(CallAvailability.READY)).toBeNull();
    expect(callAvailabilityMessage(CallAvailability.UNSPECIFIED)).toContain("Checking");
    expect(callAvailabilityMessage(CallAvailability.UNREACHABLE)).toContain("unavailable");
  });
});
