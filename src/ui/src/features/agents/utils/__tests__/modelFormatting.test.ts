import { describe, expect, it } from "vitest";
import { formatContextWindow, formatPricePer1M } from "@/features/agents/utils/modelFormatting";

describe("formatContextWindow", () => {
  it.each([
    [200_000, "200k"],
    [400_000, "400k"],
    [1_000_000, "1M"],
    [1_048_576, "1.05M"],
    [1_050_000, "1.05M"],
    [2_000_000, "2M"],
  ])("formats %i tokens as %s", (tokens, expected) => {
    expect(formatContextWindow(tokens)).toBe(expected);
  });
});

describe("formatPricePer1M", () => {
  it.each([
    ["3", "$3"],
    ["15.00", "$15"],
    ["18.75", "$18.75"],
    ["180", "$180"],
    ["0.25", "$0.25"],
    ["0.075", "$0.075"],
    ["0.003625", "$0.0036"],
    ["0", "$0"],
  ])("formats %s as %s", (rate, expected) => {
    expect(formatPricePer1M(rate)).toBe(expected);
  });

  it.each([[""], [undefined], ["not-a-number"], ["-1"]])(
    "returns null for %s",
    (rate: string | undefined) => {
      expect(formatPricePer1M(rate)).toBeNull();
    },
  );
});
