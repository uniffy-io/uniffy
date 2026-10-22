import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DayTotalSchema,
  TimePolicySchema,
  WorklogSchema,
  WorklogSource,
} from "@uniffy/proto/projects/v1/time_pb";
import {
  dayTotalToPlain,
  localDayKey,
  timePolicyToPlain,
  worklogToPlain,
} from "@features/projects/timeSerializer";
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

describe("timerToPlain", () => {
  it("keeps the running segment start and maps the limit reason", async () => {
    const { create } = await import("@bufbuild/protobuf");
    const { timestampFromDate } = await import("@bufbuild/protobuf/wkt");
    const { TimerPauseReason, TimerSchema } = await import("@uniffy/proto/projects/v1/time_pb");
    const { formatClock, timerElapsedSeconds, timerToPlain } =
      await import("@features/projects/timeSerializer");
    const started = new Date("2026-10-22T10:00:00.000Z");
    const plain = timerToPlain(
      create(TimerSchema, {
        id: "t",
        taskId: "task",
        projectId: "project",
        description: "Pairing",
        startedAt: timestampFromDate(started),
        accumulatedSeconds: 30,
        pauseReason: TimerPauseReason.LIMIT,
        taskTitle: "Home feed",
        taskNumber: 169,
        projectSlug: "mob",
      }),
    );
    expect(plain.startedAt).toBe(started.toISOString());
    expect(plain.pausedAt).toBeNull();
    expect(plain.pauseReason).toBe("limit");
    expect(plain.taskNumber).toBe(169);
    expect(timerElapsedSeconds(plain, started.getTime() + 90_000)).toBe(120);
    expect(timerElapsedSeconds({ ...plain, startedAt: null }, Date.now())).toBe(30);
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(65)).toBe("01:05");
  });
});

describe("week serializers", () => {
  it("maps a day total and the policy fields the week needs", () => {
    expect(
      dayTotalToPlain(
        create(DayTotalSchema, { day: "2026-10-22", minutes: 90, requiredMinutes: 240, off: true }),
      ),
    ).toEqual({ day: "2026-10-22", minutes: 90, requiredMinutes: 240, off: true });

    const policy = timePolicyToPlain(
      create(TimePolicySchema, {
        enabled: true,
        weekStart: "sunday",
        approvalsEnabled: true,
        requiredMinutesPerDay: 420,
      }),
    );
    expect(policy).toEqual({
      enabled: true,
      weekStart: "sunday",
      approvalsEnabled: true,
      requiredMinutesPerDay: 420,
      internalProjectId: null,
    });
    expect(
      timePolicyToPlain(create(TimePolicySchema, { internalProjectId: "p-int" })).internalProjectId,
    ).toBe("p-int");
  });
});
