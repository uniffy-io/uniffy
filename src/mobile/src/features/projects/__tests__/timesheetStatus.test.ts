import { describe, expect, it } from "vitest";
import type { SerializedTimesheet } from "@features/projects/timeSerializer";
import {
  canRecall,
  canSubmit,
  lockHint,
  sheetFor,
  sheetSummary,
} from "@features/projects/timesheetStatus";

const NOW = Date.parse("2026-10-27T12:00:00Z");

function sheet(overrides: Partial<SerializedTimesheet> = {}): SerializedTimesheet {
  return {
    periodStart: "2026-10-19",
    periodEnd: "2026-10-25",
    status: "open",
    submittedAt: null,
    reviewComment: "",
    graceUntil: null,
    locked: false,
    periodClosed: false,
    totalMinutes: 2400,
    requiredMinutes: 2400,
    submittedToUserId: null,
    reviewerUserIds: [],
    ...overrides,
  };
}

describe("sheet actions", () => {
  it("submits an open or rejected sheet and recalls a submitted one", () => {
    expect(canSubmit(sheet(), NOW)).toBe(true);
    expect(canSubmit(sheet({ status: "rejected" }), NOW)).toBe(true);
    expect(canSubmit(sheet({ status: "approved" }), NOW)).toBe(false);
    expect(canRecall(sheet({ status: "submitted" }))).toBe(true);
    expect(canRecall(sheet({ status: "submitted", periodClosed: true }))).toBe(false);
  });

  it("submits a locked sheet only while grace runs", () => {
    expect(canSubmit(sheet({ locked: true }), NOW)).toBe(false);
    expect(canSubmit(sheet({ locked: true, graceUntil: "2026-10-28T12:00:00Z" }), NOW)).toBe(true);
  });
});

describe("lockHint", () => {
  it("says nothing while the days accept writes", () => {
    expect(lockHint(undefined)).toBeUndefined();
    expect(lockHint(sheet({ status: "approved" }))).toBeUndefined();
  });

  it("names what to do for each kind of lock", () => {
    expect(lockHint(sheet({ locked: true, periodClosed: true }))).toBe("This period is closed.");
    expect(lockHint(sheet({ locked: true, status: "submitted" }))).toBe(
      "Submitted for review; recall it to edit.",
    );
    expect(lockHint(sheet({ locked: true, status: "approved" }))).toBe(
      "Approved; ask your reviewer to reopen it.",
    );
  });
});

describe("sheetSummary", () => {
  it("names the reviewer a submitted sheet waits on", () => {
    const summary = sheetSummary(
      sheet({ status: "submitted", submittedAt: "2026-10-26T09:00:00Z" }),
      "Alice Johnson",
      NOW,
    );
    expect(summary.label).toBe("Submitted");
    expect(summary.detail).toBe("Waiting for review by Alice Johnson since Oct 26.");
  });

  it("adds the grace window to an approved sheet", () => {
    const summary = sheetSummary(
      sheet({ status: "approved", graceUntil: "2026-10-28T12:00:00Z" }),
      undefined,
      NOW,
    );
    expect(summary.tone).toBe("success");
    expect(summary.detail).toBe("Your reviewer approved this period. Open for edits for 24h more.");
  });

  it("reads an open sheet past its lock date as locked", () => {
    const summary = sheetSummary(sheet({ locked: true }), undefined, NOW);
    expect(summary.label).toBe("Locked");
    expect(summary.tone).toBe("warning");
  });
});

describe("sheetFor", () => {
  it("finds the sheet whose period holds the day", () => {
    const first = sheet();
    const second = sheet({ periodStart: "2026-10-26", periodEnd: "2026-11-01" });
    expect(sheetFor([first, second], "2026-10-27")).toBe(second);
    expect(sheetFor([first, undefined], "2026-11-05")).toBeUndefined();
  });
});
