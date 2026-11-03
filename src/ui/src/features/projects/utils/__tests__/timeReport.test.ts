import { describe, expect, it } from "vitest";
import type { AggregateRow } from "@/features/projects/types/time";
import {
  CHART_ROW_LIMIT,
  axisLabel,
  chartRows,
  dayTick,
  hoursTick,
  presetRange,
  readTimeReportState,
  timeReportSearchParams,
  rangeIsValid,
  shareOf,
} from "@/features/projects/utils/timeReport";

const row = (key: string, minutes: number): AggregateRow => ({
  key,
  label: key,
  minutes,
  entries: 1,
});

describe("report URL state", () => {
  const saved = { preset: null, from: "2026-09-01", to: "2026-10-20", groupBy: "task" as const };

  it("restores the saved selection when reopening without report parameters", () => {
    expect(
      readTimeReportState(new URLSearchParams("source=project"), "2026-11-03", "monday", saved),
    ).toEqual(saved);
  });

  it("lets explicit links override remembered selections", () => {
    expect(
      readTimeReportState(new URLSearchParams("groupBy=day"), "2026-11-03", "monday", saved),
    ).toEqual({
      preset: "month",
      groupBy: "day",
      from: "2026-10-07",
      to: "2026-11-03",
    });
  });

  it("defaults to four weeks grouped by person", () => {
    expect(readTimeReportState(new URLSearchParams(), "2026-10-22", "monday")).toEqual({
      preset: "month",
      groupBy: "user",
      from: "2026-09-25",
      to: "2026-10-22",
    });
  });

  it.each(["user", "task", "day"] as const)(
    "restores %s grouping and exact dates after returning",
    (groupBy) => {
      const state = { preset: "quarter" as const, from: "2026-07-31", to: "2026-10-22", groupBy };
      const params = timeReportSearchParams(new URLSearchParams("source=project"), state);
      expect(params.get("source")).toBe("project");
      expect(readTimeReportState(params, "2026-11-03", "sunday")).toEqual(state);
    },
  );

  it("restores custom ranges including a cleared date", () => {
    const state = { preset: null, from: "", to: "2026-10-22", groupBy: "task" as const };
    const params = timeReportSearchParams(new URLSearchParams(), state);
    expect(readTimeReportState(params, "2026-11-03", "monday")).toEqual(state);
  });

  it("rejects malformed dates and unsupported grouping", () => {
    const params = new URLSearchParams("preset=week&from=2026-02-30&to=bad&groupBy=other");
    expect(readTimeReportState(params, "2026-10-22", "monday")).toEqual({
      preset: "week",
      groupBy: "user",
      from: "2026-10-19",
      to: "2026-10-25",
    });
  });

  it("treats explicit dates without a preset as custom", () => {
    const params = new URLSearchParams("from=2026-10-01&to=2026-10-15&groupBy=day");
    expect(readTimeReportState(params, "2026-11-03", "monday")).toEqual({
      preset: null,
      groupBy: "day",
      from: "2026-10-01",
      to: "2026-10-15",
    });
  });
});

describe("presetRange", () => {
  it("covers the current week from the configured week start", () => {
    expect(presetRange("week", "2026-10-22", "monday")).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
    expect(presetRange("week", "2026-10-22", "sunday")).toEqual({
      from: "2026-10-18",
      to: "2026-10-24",
    });
  });

  it("ends the rolling windows today", () => {
    expect(presetRange("month", "2026-10-22", "monday")).toEqual({
      from: "2026-09-25",
      to: "2026-10-22",
    });
    expect(presetRange("quarter", "2026-10-22", "monday")).toEqual({
      from: "2026-07-31",
      to: "2026-10-22",
    });
  });
});

describe("rangeIsValid", () => {
  it("needs both ends in order", () => {
    expect(rangeIsValid("2026-10-01", "2026-10-01")).toBe(true);
    expect(rangeIsValid("2026-10-02", "2026-10-01")).toBe(false);
    expect(rangeIsValid("", "2026-10-01")).toBe(false);
  });
});

describe("chartRows", () => {
  it("keeps days in calendar order and caps the count", () => {
    const days = Array.from({ length: 20 }, (_, i) =>
      row(`2026-10-${String(i + 1).padStart(2, "0")}`, i),
    );
    expect(chartRows(days, "day").map((r) => r.key)).toEqual(
      days.slice(0, CHART_ROW_LIMIT).map((r) => r.key),
    );
  });

  it("ranks people and tasks by minutes", () => {
    const rows = [row("a", 10), row("b", 300), row("c", 120)];
    expect(chartRows(rows, "user").map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});

describe("labels", () => {
  it("formats shares, hour ticks and day ticks", () => {
    expect(shareOf(30, 120)).toBe("25%");
    expect(shareOf(30, 0)).toBe("");
    expect(hoursTick(0)).toBe("0");
    expect(hoursTick(45)).toBe("45m");
    expect(hoursTick(60)).toBe("1h");
    expect(hoursTick(90)).toBe("1.5h");
    expect(dayTick("2026-10-03")).toBe("3/10");
    expect(axisLabel("Short title")).toBe("Short title");
    expect(axisLabel("Load testing harness: add a circuit breaker for mail relay")).toBe(
      "Load testing harness:…",
    );
  });
});
