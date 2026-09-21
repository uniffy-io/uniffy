import { describe, expect, it } from "vitest";
import type { Task } from "@/features/projects/types/project";
import { isTaskBlocked, openBlockerCount } from "@/features/projects/utils/taskRelations";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    completedAt: null,
    blockedByTaskIds: [],
    ...overrides,
  } as Task;
}

const DONE = "2026-09-01T00:00:00Z";

function lookupOf(tasks: Task[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (id: string) => byId.get(id);
}

describe("blocked tasks", () => {
  const openA = task("a");
  const openB = task("b");
  const closedC = task("c", { completedAt: DONE });
  const lookup = lookupOf([openA, openB, closedC]);

  it("is not blocked without blockers", () => {
    expect(openBlockerCount(task("t"), lookup)).toBe(0);
    expect(isTaskBlocked(task("t"), lookup)).toBe(false);
  });

  it("is blocked by an open blocker", () => {
    expect(isTaskBlocked(task("t", { blockedByTaskIds: ["a"] }), lookup)).toBe(true);
  });

  it("is free once every blocker is complete", () => {
    expect(isTaskBlocked(task("t", { blockedByTaskIds: ["c"] }), lookup)).toBe(false);
  });

  it("ignores a blocker that is not loaded", () => {
    expect(isTaskBlocked(task("t", { blockedByTaskIds: ["gone"] }), lookup)).toBe(false);
  });

  it("is never blocked once complete", () => {
    const done = task("t", { blockedByTaskIds: ["a"], completedAt: DONE });
    expect(openBlockerCount(done, lookup)).toBe(0);
    expect(isTaskBlocked(done, lookup)).toBe(false);
  });

  it("counts only the open loaded blockers", () => {
    const mixed = task("t", { blockedByTaskIds: ["a", "b", "c", "gone"] });
    expect(openBlockerCount(mixed, lookup)).toBe(2);
  });
});
