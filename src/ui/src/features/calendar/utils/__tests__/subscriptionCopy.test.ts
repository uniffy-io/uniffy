import { describe, expect, it } from "vitest";
import type { CalendarSubscriptionInfo } from "@/features/calendar/types";
import { subscriptionErrorCopy } from "@/features/calendar/utils/subscriptionCopy";

function feed(overrides: Partial<CalendarSubscriptionInfo>): CalendarSubscriptionInfo {
  return {
    urlHost: "calendar.example.com",
    refreshIntervalMinutes: 60,
    countsAsBusy: false,
    state: "failing",
    consecutiveFailures: 1,
    lastErrorStatus: 0,
    eventCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

describe("subscriptionErrorCopy", () => {
  it.each([401, 403, 404, 410])("tells the member a %i link was reset", (status) => {
    expect(
      subscriptionErrorCopy(feed({ lastError: "http_status", lastErrorStatus: status })),
    ).toMatch(/paste the new one/);
  });

  it("separates a server error from a dead link", () => {
    expect(subscriptionErrorCopy(feed({ lastError: "http_status", lastErrorStatus: 503 }))).toBe(
      "The calendar's server returned an error.",
    );
  });

  it("names a refused private address", () => {
    expect(subscriptionErrorCopy(feed({ lastError: "blocked_address" }))).toMatch(
      /private network/,
    );
  });

  it("falls back for an error it does not know", () => {
    expect(subscriptionErrorCopy(feed({}))).toBe("The calendar could not be refreshed.");
  });
});
