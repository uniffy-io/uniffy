import { describe, expect, it } from "vitest";
import { formatMinutes, parseTimeInput } from "@/shared/utils/durationFormatting";

describe("formatMinutes", () => {
  it("renders minutes, whole hours and mixed values", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(150)).toBe("2h 30m");
  });
});

describe("parseTimeInput", () => {
  it("accepts the hour, minute, decimal and bare forms", () => {
    expect(parseTimeInput("2h 30m")).toBe(150);
    expect(parseTimeInput("2h30m")).toBe(150);
    expect(parseTimeInput("1.5h")).toBe(90);
    expect(parseTimeInput("45m")).toBe(45);
    expect(parseTimeInput("45")).toBe(45);
    expect(parseTimeInput(" 2H ")).toBe(120);
  });

  it("rejects anything else", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("soon")).toBeNull();
    expect(parseTimeInput("-5")).toBeNull();
    expect(parseTimeInput("2h x")).toBeNull();
  });
});
