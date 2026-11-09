import { describe, expect, it } from "vitest";
import type { EventActivity } from "@/features/calendar/types";
import { parseSyncConflict, replacedEntries } from "@/features/calendar/utils/syncConflict";

const activity = (overrides: Partial<EventActivity>): EventActivity => ({
  id: "a",
  eventId: "e",
  actorId: "u",
  action: "sync_conflict",
  timestamp: "2026-11-01T10:00:00Z",
  ...overrides,
});

describe("parseSyncConflict", () => {
  it("reads the summary, the fields and the values that lost", () => {
    expect(
      parseSyncConflict(
        activity({
          fieldId: "title,location",
          previousValue: JSON.stringify({
            summary: "Your change was replaced by a newer edit in Outlook",
            winner: "provider",
            title: "Planning",
            location: null,
          }),
          newValue: JSON.stringify({ title: "Plan", location: "Room 1" }),
        }),
      ),
    ).toEqual({
      summary: "Your change was replaced by a newer edit in Outlook",
      winner: "provider",
      fields: ["title", "location"],
      replaced: { title: "Planning" },
    });
  });

  it("degrades to an empty account on malformed values", () => {
    expect(parseSyncConflict(activity({ previousValue: "not json" }))).toEqual({
      summary: "",
      winner: null,
      fields: [],
      replaced: {},
    });
  });

  it("reads a Uniffy win and ignores an unknown winner", () => {
    const read = (winner: unknown) =>
      parseSyncConflict(activity({ previousValue: JSON.stringify({ summary: "s", winner }) }))
        .winner;
    expect(read("uniffy")).toBe("uniffy");
    expect(read("someone")).toBeNull();
  });
});

describe("replacedEntries", () => {
  it("lists every replaced field in order and shortens long text", () => {
    const description = `${"word ".repeat(60)}\n\nend`;
    const conflict = parseSyncConflict(
      activity({
        fieldId: "title,start_time,end_time,location,description,status",
        previousValue: JSON.stringify({
          winner: "uniffy",
          title: "Sync",
          start_time: "2026-11-02T09:00:00Z",
          end_time: "2026-11-02T10:00:00Z",
          location: "Room 2",
          description,
          status: "tentative",
        }),
      }),
    );
    const entries = replacedEntries(conflict);
    expect(entries.map(([field]) => field)).toEqual([
      "title",
      "start_time",
      "end_time",
      "location",
      "description",
      "status",
    ]);
    const shortened = entries[4][1];
    expect(shortened.length).toBeLessThanOrEqual(140);
    expect(shortened.endsWith("\u2026")).toBe(true);
    expect(shortened).not.toContain("\n");
    expect(entries[1][1]).toBe("2026-11-02T09:00:00Z");
  });
});
