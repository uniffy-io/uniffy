import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  clockTimeToDecimalHours,
  decimalHoursToClockTime,
  isValidClockTime,
  quietHoursToggleUpdate,
  quietHoursValidationError,
} from "@/features/settings/utils/quietHours";

describe("isValidClockTime", () => {
  it("accepts strict zero-padded HH:MM", () => {
    expect(isValidClockTime("00:00")).toBe(true);
    expect(isValidClockTime("08:30")).toBe(true);
    expect(isValidClockTime("23:59")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidClockTime("9:00")).toBe(false);
    expect(isValidClockTime("24:00")).toBe(false);
    expect(isValidClockTime("12:60")).toBe(false);
    expect(isValidClockTime("noon")).toBe(false);
    expect(isValidClockTime("")).toBe(false);
  });
});

describe("quietHoursValidationError", () => {
  it("passes valid pairs, including overnight windows", () => {
    expect(quietHoursValidationError("09:00", "17:00")).toBeNull();
    expect(quietHoursValidationError("22:00", "08:00")).toBeNull();
  });

  it("rejects invalid times", () => {
    expect(quietHoursValidationError("9:00", "17:00")).toMatch(/Start/);
    expect(quietHoursValidationError("09:00", "25:00")).toMatch(/End/);
    expect(quietHoursValidationError("", "08:00")).toMatch(/Start/);
  });

  it("rejects equal start and end", () => {
    expect(quietHoursValidationError("10:00", "10:00")).toMatch(/differ/);
  });
});

describe("quietHoursToggleUpdate", () => {
  it("enables with the default overnight window, both fields together", () => {
    expect(quietHoursToggleUpdate(true)).toEqual({
      quietHoursStart: DEFAULT_QUIET_HOURS_START,
      quietHoursEnd: DEFAULT_QUIET_HOURS_END,
    });
    expect(
      quietHoursValidationError(DEFAULT_QUIET_HOURS_START, DEFAULT_QUIET_HOURS_END),
    ).toBeNull();
  });

  it("clears with empty strings for both fields", () => {
    expect(quietHoursToggleUpdate(false)).toEqual({ quietHoursStart: "", quietHoursEnd: "" });
  });
});

describe("decimal-hours conversion for the time dropdown", () => {
  it("converts HH:MM to decimal hours", () => {
    expect(clockTimeToDecimalHours("00:00")).toBe(0);
    expect(clockTimeToDecimalHours("08:30")).toBe(8.5);
    expect(clockTimeToDecimalHours("22:00")).toBe(22);
    expect(clockTimeToDecimalHours("09:15")).toBe(9.25);
  });

  it("converts decimal hours back to zero-padded HH:MM", () => {
    expect(decimalHoursToClockTime(0)).toBe("00:00");
    expect(decimalHoursToClockTime(8.5)).toBe("08:30");
    expect(decimalHoursToClockTime(22)).toBe("22:00");
    expect(decimalHoursToClockTime(9.25)).toBe("09:15");
  });

  it("round-trips every dropdown preset to a valid clock time", () => {
    for (let i = 0; i < 48; i++) {
      const clock = decimalHoursToClockTime(i * 0.5);
      expect(isValidClockTime(clock)).toBe(true);
      expect(clockTimeToDecimalHours(clock)).toBe(i * 0.5);
    }
  });

  it("stays within the clock for near-midnight values", () => {
    expect(decimalHoursToClockTime(23.9999)).toBe("00:00");
  });
});
