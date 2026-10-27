import { describe, expect, it } from "vitest";
import { endOf, entryProblem, minutesOfDay, wallOf } from "@features/projects/timeClock";

describe("wall clock", () => {
  it("converts between walls and minutes", () => {
    expect(minutesOfDay("09:30")).toBe(570);
    expect(wallOf(570)).toBe("09:30");
    expect(wallOf(1440)).toBe("24:00");
  });

  it("ends a start plus a length, capped at midnight", () => {
    expect(endOf("13:00", 90)).toBe("14:30");
    expect(endOf("23:00", 120)).toBe("24:00");
  });
});

describe("entryProblem", () => {
  it("accepts a day's worth and nothing more", () => {
    expect(entryProblem(1440, null)).toBeNull();
    expect(entryProblem(1500, null)).toBe(
      "An entry can hold at most 24h, and 25h is longer than a day. Split it into one entry per day.",
    );
  });

  it("refuses an entry on the clock that runs past midnight", () => {
    expect(entryProblem(120, "22:00")).toBeNull();
    expect(entryProblem(150, "22:00")).toBe("Starting at 22:00, at most 2h fits before midnight.");
  });

  it("stays quiet before a length is typed", () => {
    expect(entryProblem(null, "09:00")).toBeNull();
  });
});
