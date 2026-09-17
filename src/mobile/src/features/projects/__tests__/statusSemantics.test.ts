import { describe, expect, it } from "vitest";
import type { PlainSelectOption } from "@features/projects/projectsSerializer";
import {
  isCompletedStatus,
  isRequiredStatusOption,
  statusIdForSemantic,
  statusOptionsOf,
  statusSemanticOf,
} from "@features/projects/statusSemantics";

function option(id: string, overrides: Partial<PlainSelectOption> = {}): PlainSelectOption {
  return { id, label: id, color: "", sortOrder: 0, ...overrides };
}

const CUSTOM: PlainSelectOption[] = [
  option("status_backlog", { semantic: "todo" }),
  option("status_doing", { semantic: "in_progress" }),
  option("status_done", { semantic: "review" }),
  option("status_shipped", { semantic: "completed" }),
];

describe("status semantics", () => {
  it("prefer the stored semantic over the legacy id", () => {
    expect(statusSemanticOf(option("status_done", { semantic: "review" }))).toBe("review");
  });

  it("fall back to the legacy table only when no semantic is stored", () => {
    expect(statusSemanticOf(option("status_done"))).toBe("completed");
    expect(statusSemanticOf(option("status_todo"))).toBe("todo");
    expect(statusSemanticOf(option("status_blocked"))).toBeNull();
  });

  it("resolve a custom completed status", () => {
    expect(statusIdForSemantic(CUSTOM, "completed")).toBe("status_shipped");
    expect(isCompletedStatus(CUSTOM, "status_shipped")).toBe(true);
    expect(isCompletedStatus(CUSTOM, "status_done")).toBe(false);
    expect(isCompletedStatus(CUSTOM, undefined)).toBe(false);
  });

  it("return null when no status carries the semantic", () => {
    expect(statusIdForSemantic([option("status_blocked")], "todo")).toBeNull();
  });

  it("protect to do, in progress and completed only", () => {
    expect(CUSTOM.map(isRequiredStatusOption)).toEqual([true, true, false, true]);
  });

  it("use the defaults when the project is not loaded", () => {
    const defaults = statusOptionsOf(undefined);
    expect(statusIdForSemantic(defaults, "completed")).toBe("status_done");
    expect(statusIdForSemantic(defaults, "todo")).toBe("status_todo");
  });
});
