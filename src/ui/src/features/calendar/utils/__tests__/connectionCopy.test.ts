import { describe, expect, it } from "vitest";
import {
  connectedStateCopy,
  credentialSourceCopy,
  needsAttention,
  providerEditHintCopy,
  syncErrorCopy,
} from "@/features/calendar/utils/connectionCopy";
import { connectionsPath, focusedConnectionId } from "@/features/calendar/utils/connectionRoutes";

describe("connected calendar copy", () => {
  it("stays quiet while a calendar is healthy", () => {
    expect(connectedStateCopy("healthy", undefined, "google")).toBeNull();
  });

  it("describes what holds a calendar back", () => {
    expect(connectedStateCopy("pending", undefined, "google")).toBe(
      "Syncing for the first time...",
    );
    expect(connectedStateCopy("paused", undefined, "google")).toBe("Paused");
    expect(connectedStateCopy("reauth_required", undefined, "microsoft")).toBe(
      "Microsoft sign-in expired. Reconnect to resume.",
    );
    expect(connectedStateCopy("detached", undefined, null)).toContain("no longer sync");
  });

  it("names the error behind a failing calendar", () => {
    expect(connectedStateCopy("broken", "not_found", "microsoft")).toBe(
      "The calendar no longer exists in Outlook.",
    );
    expect(syncErrorCopy("unreachable", "google")).toBe("Could not reach Google Calendar.");
    expect(syncErrorCopy(undefined, null)).toBe("The calendar could not be synced.");
  });

  it("flags only the states the member must act on", () => {
    expect(needsAttention("broken")).toBe(true);
    expect(needsAttention("reauth_required")).toBe(true);
    expect(needsAttention("failing")).toBe(false);
    expect(needsAttention("paused")).toBe(false);
  });

  it("points edits to the provider, by event or series", () => {
    expect(providerEditHintCopy("google", false)).toBe("Edit this event in Google Calendar");
    expect(providerEditHintCopy("microsoft", true)).toBe("Edit this series in Outlook");
  });

  it("names where a provider app comes from", () => {
    expect(credentialSourceCopy("deployment")).toBe("Using the deployment's app");
    expect(credentialSourceCopy("organization")).toBe("Using this organization's app");
    expect(credentialSourceCopy("none")).toBe("Not configured");
  });
});

describe("connections links", () => {
  it("opens the dialog on one account or on all of them", () => {
    expect(connectionsPath("conn")).toBe("/calendar?connections=conn");
    expect(connectionsPath()).toBe("/calendar?connections=all");
    expect(connectionsPath("conn", "/calendar?calendar=c1")).toBe(
      "/calendar?calendar=c1&connections=conn",
    );
    expect(focusedConnectionId("all")).toBeNull();
    expect(focusedConnectionId("conn")).toBe("conn");
  });
});
