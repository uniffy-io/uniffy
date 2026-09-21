import { afterEach, describe, it, expect } from "vitest";
import {
  calendarDayKey,
  formatDateShort,
  formatDateFull,
  formatDateWithWeekday,
  formatProtoDate,
  formatProtoDateTime,
  isOverdue,
  formatRelativeTime,
  formatMediaTime,
  formatFileSize,
  formatTimeInZone,
  parseCalendarDate,
} from "@/shared/utils/dateFormatting";
import { setPreferredTimeZone } from "@/shared/utils/timezone";

function localDateString(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

describe("parseCalendarDate", () => {
  it("reads YYYY-MM-DD as a local calendar date regardless of zone", () => {
    const d = parseCalendarDate("2026-08-13");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(13);
  });
});

describe("formatDateShort", () => {
  it("formats date in current year without year", () => {
    const thisYear = new Date().getFullYear();
    const result = formatDateShort(`${thisYear}-03-15`);
    expect(result).toContain("Mar");
    expect(result).toContain("15");
    expect(result).not.toContain(String(thisYear));
  });

  it("includes year for dates in a different year", () => {
    const result = formatDateShort("2020-06-01");
    expect(result).toContain("Jun");
    expect(result).toContain("2020");
  });
});

describe("formatDateFull", () => {
  it("always includes the year", () => {
    const result = formatDateFull("2026-01-05");
    expect(result).toContain("Jan");
    expect(result).toContain("5");
    expect(result).toContain("2026");
  });
});

describe("formatDateWithWeekday", () => {
  it("includes the weekday", () => {
    // 2026-02-22 is a Sunday
    const result = formatDateWithWeekday("2026-02-22");
    expect(result).toContain("Sun");
    expect(result).toContain("Feb");
    expect(result).toContain("22");
  });
});

describe("formatProtoDate", () => {
  it("returns - for undefined timestamp", () => {
    expect(formatProtoDate(undefined)).toBe("-");
  });

  it("formats numeric seconds", () => {
    // 2026-01-15 00:00:00 UTC
    const result = formatProtoDate({ seconds: 1768435200, nanos: 0 });
    expect(result).toContain("Jan");
  });

  it("formats bigint seconds", () => {
    const result = formatProtoDate({ seconds: BigInt(1768435200), nanos: 0 });
    expect(result).toContain("Jan");
  });
});

describe("formatProtoDateTime", () => {
  it("returns - for undefined timestamp", () => {
    expect(formatProtoDateTime(undefined)).toBe("-");
  });

  it("includes time component", () => {
    // Check it returns a non-empty string with date parts
    const result = formatProtoDateTime({ seconds: 1768435200, nanos: 0 });
    expect(result).not.toBe("-");
    expect(result.length).toBeGreaterThan(5);
  });
});

describe("calendarDayKey", () => {
  afterEach(() => setPreferredTimeZone(null));

  it("keeps a date-only value as written in every zone", () => {
    setPreferredTimeZone("America/Los_Angeles");
    expect(calendarDayKey("2026-09-17")).toBe("2026-09-17");
  });

  it("reads a timestamp on the effective zone's calendar", () => {
    setPreferredTimeZone("America/Los_Angeles");
    expect(calendarDayKey("2026-09-17T03:00:00Z")).toBe("2026-09-16");
    setPreferredTimeZone("Asia/Tokyo");
    expect(calendarDayKey("2026-09-16T20:00:00Z")).toBe("2026-09-17");
  });
});

describe("isOverdue", () => {
  it("returns true for past dates", () => {
    expect(isOverdue("2020-01-01")).toBe(true);
  });

  it("returns false for future dates", () => {
    expect(isOverdue("2099-12-31")).toBe(false);
  });

  it("a task due today is not overdue in any zone", () => {
    expect(isOverdue(localDateString(new Date()))).toBe(false);
  });

  it("a task due yesterday is overdue", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isOverdue(localDateString(yesterday))).toBe(true);
  });

  it("a task due tomorrow is not overdue", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isOverdue(localDateString(tomorrow))).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  it("returns empty string for undefined", () => {
    expect(formatRelativeTime(undefined)).toBe("");
  });

  it("returns Just now for very recent", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("Just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const threeHrAgo = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(formatRelativeTime(threeHrAgo)).toBe("3h ago");
  });

  it("returns Yesterday for 1 day ago", () => {
    const yesterday = new Date(Date.now() - 25 * 3600000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe("Yesterday");
  });

  it("returns days ago for <7 days", () => {
    const threeDays = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(formatRelativeTime(threeDays)).toBe("3d ago");
  });

  it("falls back to date string for old dates", () => {
    const result = formatRelativeTime("2020-01-15T12:00:00Z");
    expect(result).toContain("Jan");
  });
});

describe("formatMediaTime", () => {
  it("formats zero", () => {
    expect(formatMediaTime(0)).toBe("0:00");
  });

  it("handles negative", () => {
    expect(formatMediaTime(-5)).toBe("0:00");
  });

  it("handles NaN", () => {
    expect(formatMediaTime(NaN)).toBe("0:00");
  });

  it("formats seconds only", () => {
    expect(formatMediaTime(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatMediaTime(125)).toBe("2:05");
  });

  it("formats hours, minutes, seconds", () => {
    expect(formatMediaTime(3723)).toBe("1:02:03");
  });
});

describe("formatTimeInZone", () => {
  // 2026-01-15 12:00:00 UTC; both zones are outside DST in January.
  const at = new Date("2026-01-15T12:00:00Z");

  it("renders the wall clock of the given zone", () => {
    expect(formatTimeInZone(at, "UTC")).toMatch(/12/);
    expect(formatTimeInZone(at, "Europe/Sofia")).toMatch(/2/); // UTC+2
  });

  it("differs across zones for the same instant", () => {
    expect(formatTimeInZone(at, "America/New_York")).not.toBe(formatTimeInZone(at, "Asia/Tokyo"));
  });
});

describe("formatFileSize", () => {
  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats KB", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats MB", () => {
    expect(formatFileSize(5242880)).toBe("5 MB");
  });

  it("formats GB", () => {
    expect(formatFileSize(1073741824)).toBe("1 GB");
  });
});
