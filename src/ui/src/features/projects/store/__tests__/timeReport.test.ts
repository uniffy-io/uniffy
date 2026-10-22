import { describe, expect, it } from "vitest";
import type { RootState } from "@/app/store";
import {
  initialTimeState,
  selectProjectReport,
  selectReportLoading,
  timeReducer,
} from "@/features/projects/store/timeSlice";
import { fetchProjectReport } from "@/features/projects/store/timeThunks";
import { reportKey, type ProjectReport, type ReportQuery } from "@/features/projects/types/time";

const query: ReportQuery = {
  projectId: "p1",
  from: "2026-10-01",
  to: "2026-10-28",
  groupBy: "user",
};
const key = reportKey(query);
const report: ProjectReport = {
  rows: [{ key: "u1", label: "Ivan", minutes: 90, entries: 2 }],
  totalMinutes: 90,
};

function stateWith(time = initialTimeState): RootState {
  return { time } as unknown as RootState;
}

describe("project reports", () => {
  it("keys a report by project, range and grouping", () => {
    expect(key).toBe("p1:2026-10-01:2026-10-28:user");
    expect(reportKey({ ...query, groupBy: "task" })).not.toBe(key);
  });

  it("tracks loading per key and stores the result", () => {
    const pending = timeReducer(initialTimeState, fetchProjectReport.pending("r", query));
    expect(selectReportLoading(key)(stateWith(pending))).toBe(true);
    expect(selectProjectReport(key)(stateWith(pending))).toBeNull();

    const done = timeReducer(pending, fetchProjectReport.fulfilled(report, "r", query));
    expect(selectReportLoading(key)(stateWith(done))).toBe(false);
    expect(selectProjectReport(key)(stateWith(done))).toEqual(report);
  });

  it("keeps the last report while a refresh fails", () => {
    const loaded = timeReducer(initialTimeState, fetchProjectReport.fulfilled(report, "r", query));
    const refreshing = timeReducer(loaded, fetchProjectReport.pending("s", query));
    const failed = timeReducer(
      refreshing,
      fetchProjectReport.rejected(null, "s", query, "Failed to load the time report"),
    );

    expect(selectProjectReport(key)(stateWith(failed))).toEqual(report);
    expect(selectReportLoading(key)(stateWith(failed))).toBe(false);
  });
});
