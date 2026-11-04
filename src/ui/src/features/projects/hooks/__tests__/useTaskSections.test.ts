import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_SECTIONS,
  parseTaskSections,
} from "@/features/projects/hooks/useTaskSections";

describe("parseTaskSections", () => {
  it("uses the defaults when nothing is stored or the value is unreadable", () => {
    expect(parseTaskSections(null)).toEqual(DEFAULT_TASK_SECTIONS);
    expect(parseTaskSections("not json")).toEqual(DEFAULT_TASK_SECTIONS);
    expect(parseTaskSections("[1,2]")).toEqual(DEFAULT_TASK_SECTIONS);
  });

  it("keeps stored booleans and ignores unknown or mistyped keys", () => {
    const stored = JSON.stringify({ activity: true, comments: false, extra: true, fields: "yes" });
    expect(parseTaskSections(stored)).toEqual({
      ...DEFAULT_TASK_SECTIONS,
      activity: true,
      comments: false,
    });
  });
});
