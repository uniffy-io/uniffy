import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { CallAttendanceSchema } from "@uniffy/proto/calls/v1/calls_pb";
import { historyPersonToPlain } from "@features/calls/historySerializer";
import {
  activityRuns,
  activityDescription,
  activityCoverage,
} from "@features/calls/activityPresentation";

describe("speaking timeline", () => {
  it("preserves mixed coverage and clamps the final bin to actual call length", () => {
    const person = historyPersonToPlain(
      create(CallAttendanceSchema, {
        userId: "alice",
        displayName: "Alice",
        activityResolutionSeconds: 5,
        activityDurationSeconds: 17,
        observedSeconds: 1,
        speakingSeconds: 1,
        presentSeconds: 2,
        activity: [
          { offsetSeconds: 15, presentSeconds: 2, observedSeconds: 1, speakingSeconds: 1 },
        ],
      }),
    );
    expect(
      activityDescription(
        person.activity[0],
        person.activityResolutionSeconds,
        person.activityDurationSeconds,
      ),
    ).toBe("0:15 to 0:17. 1s speaking, 0s quiet, 1s unavailable.");
    expect(activityCoverage(person.observedSeconds, person.presentSeconds)).toBe("50% observed");
    expect(person.speakingSeconds).toBe(1);
  });
  it("distinguishes silence, missing samples and non-attendance", () => {
    expect(
      activityDescription(
        { offsetSeconds: 0, presentSeconds: 1, observedSeconds: 1, speakingSeconds: 0 },
        1,
        3,
      ),
    ).toContain("0s speaking, 1s quiet");
    expect(
      activityDescription(
        { offsetSeconds: 1, presentSeconds: 1, observedSeconds: 0, speakingSeconds: 0 },
        1,
        3,
      ),
    ).toContain("Activity unavailable");
    expect(
      activityDescription(
        { offsetSeconds: 2, presentSeconds: 0, observedSeconds: 0, speakingSeconds: 0 },
        1,
        3,
      ),
    ).toContain("Not in call");
  });
});

it("combines matching samples without hiding unknown time or changing input", () => {
  const samples = Array.from({ length: 240 }, (_, offsetSeconds) => ({
    offsetSeconds,
    presentSeconds: 1,
    observedSeconds: offsetSeconds < 120 ? 1 : 0,
    speakingSeconds: 0,
  }));
  const runs = activityRuns(samples, 1, 240);
  expect(runs).toHaveLength(2);
  expect(runs.map((run) => run.durationSeconds)).toEqual([120, 120]);
  expect(runs[1].observedSeconds).toBe(0);
  expect(samples).toHaveLength(240);
  expect(samples[0]).not.toHaveProperty("durationSeconds");
});
