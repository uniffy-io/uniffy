import { describe, expect, it } from "vitest";
import type { Timesheet } from "@/features/projects/types/time";
import { graceActive, periodLabel } from "../timesheet";

const sheet: Timesheet = {
  id: "s1",
  userId: "u1",
  periodStart: "2026-10-12",
  periodEnd: "2026-10-18",
  status: "submitted",
  submittedAt: null,
  submittedByUserId: null,
  submitComment: "",
  reviewerUserId: null,
  reviewedAt: null,
  reviewComment: "",
  graceUntil: null,
  locked: true,
  periodClosed: false,
  canReview: false,
  totalMinutes: 0,
  requiredMinutes: 0,
  submittedToUserId: null,
  reviewerUserIds: [],
};

describe("timesheet helpers", () => {
  it("treats grace as active only while its instant is ahead", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(graceActive(sheet, now)).toBe(false);
    expect(graceActive({ ...sheet, graceUntil: "2026-10-21T13:00:00Z" }, now)).toBe(true);
    expect(graceActive({ ...sheet, graceUntil: "2026-10-21T11:00:00Z" }, now)).toBe(false);
  });

  it("labels a period by its bounds", () => {
    expect(periodLabel(sheet)).toMatch(/Oct 12.*Oct 18/);
  });
});
