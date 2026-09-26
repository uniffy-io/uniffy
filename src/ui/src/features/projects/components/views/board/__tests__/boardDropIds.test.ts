import { describe, expect, it } from "vitest";
import {
  SINGLE_LANE_KEY,
  buildLaneCardId,
  buildLaneDropId,
  parseLaneCardId,
  parseLaneDropId,
} from "@/features/projects/components/views/board/boardDropIds";

describe("board drop ids", () => {
  it("round-trips a lane and column, separators inside keys included", () => {
    const id = buildLaneDropId("date:this_week|x", "status_done");
    expect(parseLaneDropId(id)).toEqual({ laneKey: "date:this_week|x", columnKey: "status_done" });
  });

  it("gives the same task a distinct card id in each lane", () => {
    const inAmy = buildLaneCardId("user-amy", "task-1");
    const inZoe = buildLaneCardId("user-zoe", "task-1");
    expect(inAmy).not.toBe(inZoe);
    expect(parseLaneCardId(inZoe)).toEqual({ laneKey: "user-zoe", taskId: "task-1" });
  });

  it("keeps the ungrouped board as one lane", () => {
    expect(parseLaneCardId(buildLaneCardId(SINGLE_LANE_KEY, "t"))).toEqual({
      laneKey: SINGLE_LANE_KEY,
      taskId: "t",
    });
  });

  it("does not read a card id as a drop zone or the other way round", () => {
    expect(parseLaneDropId(buildLaneCardId("a", "t"))).toBeNull();
    expect(parseLaneCardId(buildLaneDropId("a", "c"))).toBeNull();
    expect(parseLaneCardId("task-1")).toBeNull();
  });
});
