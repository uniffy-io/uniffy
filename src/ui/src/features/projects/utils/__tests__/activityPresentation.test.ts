import { describe, expect, it } from "vitest";

import type { TaskActivity } from "@/features/projects/types/activity";
import {
  activityCategory,
  listChange,
  mergeActivityRuns,
  parseNameList,
} from "@/features/projects/utils/activityPresentation";

function activity(id: string, overrides: Partial<TaskActivity> = {}): TaskActivity {
  return {
    id,
    taskId: "t1",
    actorId: "u1",
    action: "priority_changed",
    timestamp: "2026-11-02T10:00:00Z",
    ...overrides,
  };
}

describe("mergeActivityRuns", () => {
  it("keeps separate description sessions from the same editor", () => {
    const entries = mergeActivityRuns([
      activity("2", { action: "description_edited" }),
      activity("1", { action: "description_edited", timestamp: "2026-10-01T10:00:00Z" }),
    ]);
    expect(entries.map((entry) => [entry.id, entry.count])).toEqual([
      ["2", 1],
      ["1", 1],
    ]);
  });
  it("merges a run of one person's changes to one field into the net change", () => {
    const merged = mergeActivityRuns([
      activity("3", { previousValue: "high", newValue: "urgent" }),
      activity("2", { previousValue: "medium", newValue: "high" }),
      activity("1", { previousValue: "low", newValue: "medium" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "3",
      previousValue: "low",
      newValue: "urgent",
      count: 3,
    });
  });

  it("keeps changes apart when the person, the agent, the field or the action differ", () => {
    const merged = mergeActivityRuns([
      activity("5", { previousValue: "a", newValue: "b" }),
      activity("4", { actorId: "u2", previousValue: "x", newValue: "a" }),
      activity("3", { agentId: "agent-1", previousValue: "y", newValue: "x" }),
      activity("2", { action: "field_updated", fieldId: "f1" }),
      activity("1", { action: "field_updated", fieldId: "f2" }),
    ]);
    expect(merged.map((e) => e.id)).toEqual(["5", "4", "3", "2", "1"]);
  });

  it("never merges one-off events such as dependencies or time entries", () => {
    const merged = mergeActivityRuns([
      activity("2", { action: "blocked_by_added", newValue: "a" }),
      activity("1", { action: "blocked_by_added", newValue: "b" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("listChange", () => {
  it("names who was added and who was removed", () => {
    expect(listChange("a,b", "b,c")).toEqual({ added: ["c"], removed: ["a"] });
    expect(listChange(undefined, "a")).toEqual({ added: ["a"], removed: [] });
  });
});

describe("parseNameList", () => {
  it("reads JSON name lists and ignores anything else", () => {
    expect(parseNameList('["bug","ui"]')).toEqual(["bug", "ui"]);
    expect(parseNameList("not json")).toEqual([]);
    expect(parseNameList(undefined)).toEqual([]);
  });
});

describe("activityCategory", () => {
  it("groups related actions for the filter", () => {
    expect(activityCategory("due_date_changed")).toBe("dates");
    expect(activityCategory("blocking_added")).toBe("dependencies");
    expect(activityCategory("unknown")).toBe("other");
  });
});
