import { describe, expect, it, vi } from "vitest";
import type { AppDispatch } from "@/app/store";
import {
  callbackDestination,
  callbackFailureMessage,
  callbackRequest,
  completeOnce,
} from "@/features/calendar/utils/connectCallback";

vi.mock("@/features/calendar/store/calendarConnectionsThunks", () => ({
  completeCalendarConnection: Object.assign((request: unknown) => ({ type: "complete", request }), {
    rejected: {
      match: (action: { type?: string }) => action.type === "complete/rejected",
    },
  }),
}));

describe("connect callback", () => {
  it("reads what the provider sent back", () => {
    expect(callbackRequest(new URLSearchParams("code=abc&state=s1"))).toEqual({
      code: "abc",
      state: "s1",
      error: "",
      errorDescription: "",
    });
    expect(
      callbackRequest(new URLSearchParams("error=access_denied&error_description=No&state=s2")),
    ).toMatchObject({ error: "access_denied", errorDescription: "No", state: "s2" });
  });

  it("refuses an address that cannot complete anything", () => {
    expect(callbackRequest(new URLSearchParams("code=abc"))).toBeNull();
    expect(callbackRequest(new URLSearchParams("state=s1"))).toBeNull();
  });

  it("completes a sign-in state once however often it is asked", async () => {
    const dispatch = vi.fn((action: unknown) => Promise.resolve(action));
    const request = { code: "abc", state: "once", error: "", errorDescription: "" };
    const first = completeOnce(dispatch as unknown as AppDispatch, request);
    const second = completeOnce(dispatch as unknown as AppDispatch, request);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(await first).toEqual({ type: "complete", request });
  });

  it("lets a remount retry after the first call was aborted", async () => {
    const aborted = { type: "complete/rejected", meta: { aborted: true } };
    const dispatch = vi.fn(() => Promise.resolve(aborted));
    const request = { code: "abc", state: "aborted", error: "", errorDescription: "" };
    const first = completeOnce(dispatch as unknown as AppDispatch, request);
    await first;
    await Promise.resolve();
    const second = completeOnce(dispatch as unknown as AppDispatch, request);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("returns to the calendar with the new account's settings open", () => {
    expect(callbackDestination("", "conn")).toBe("/calendar?connections=conn");
    expect(callbackDestination("/calendar/evt-1", "conn")).toBe("/calendar/evt-1?connections=conn");
    expect(callbackDestination("/notes", "conn")).toBe("/notes");
  });

  it("shows the server's reason, or a generic line", () => {
    expect(
      callbackFailureMessage(
        "[invalid_argument] Validation error on 'code': The sign-in expired. Start again.",
      ),
    ).toBe("The sign-in expired. Start again.");
    expect(callbackFailureMessage(undefined)).toBe(
      "The calendar account could not be connected. Try again.",
    );
  });
});
