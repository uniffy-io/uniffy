import { describe, expect, it } from "vitest";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";

describe("toIdList", () => {
  it("keeps the string ids of an array", () => {
    expect(toIdList(["user-1", "", 3, "user-2"])).toEqual(["user-1", "user-2"]);
  });

  it("wraps a single id, as the API accepts for person fields", () => {
    expect(toIdList("user-1")).toEqual(["user-1"]);
  });

  it("returns nothing for empty or unset values", () => {
    expect(toIdList("")).toEqual([]);
    expect(toIdList(undefined)).toEqual([]);
    expect(toIdList(null)).toEqual([]);
  });
});

describe("getTaskFieldValue", () => {
  const task = makeTask({
    id: "t1",
    assigneeIds: ["user-1"],
    fieldValues: { reviewer: "user-2" },
  });

  it("reads a custom person field from its own value, not the assignees", () => {
    expect(toIdList(getTaskFieldValue(task, "reviewer"))).toEqual(["user-2"]);
    expect(toIdList(getTaskFieldValue(task, "unset_person"))).toEqual([]);
  });

  it("reads Assignee from the task's assignee ids", () => {
    expect(getTaskFieldValue(task, SYSTEM_FIELD_IDS.ASSIGNEE)).toEqual(["user-1"]);
  });
});
