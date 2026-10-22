import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { WorklogSchema, WorklogSource } from "@uniffy/proto/projects/v1/time_pb";
import { localDayKey, worklogToPlain } from "@features/projects/timeSerializer";
import { parseTimeInput } from "@features/projects/timeFormatting";

describe("worklogToPlain", () => {
  it("maps every field and the source enum", () => {
    const created = new Date("2026-10-22T09:30:00.000Z");
    const plain = worklogToPlain(
      create(WorklogSchema, {
        id: "w1",
        taskId: "t1",
        projectId: "p1",
        userId: "u1",
        createdByUserId: "u2",
        workDate: "2026-10-22",
        durationMinutes: 95,
        description: "Review",
        source: WorklogSource.TIMER,
        createdAt: timestampFromDate(created),
      }),
    );

    expect(plain).toEqual({
      id: "w1",
      taskId: "t1",
      projectId: "p1",
      userId: "u1",
      createdByUserId: "u2",
      workDate: "2026-10-22",
      durationMinutes: 95,
      description: "Review",
      source: "timer",
      createdAt: created.toISOString(),
    });
  });

  it("treats an unspecified source as manual and a missing timestamp as empty", () => {
    const plain = worklogToPlain(create(WorklogSchema, { id: "w2" }));
    expect(plain.source).toBe("manual");
    expect(plain.createdAt).toBe("");
  });
});

describe("localDayKey", () => {
  it("formats the device day with zero padding", () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("parseTimeInput", () => {
  it("rejects trailing garbage instead of reading a leading number", () => {
    expect(parseTimeInput("2h x")).toBeNull();
    expect(parseTimeInput("45")).toBe(45);
    expect(parseTimeInput("1.5h")).toBe(90);
  });
});
