import { describe, expect, it } from "vitest";

import { parentLabel, rankBlockerCandidates } from "@/features/projects/utils/blockerCandidates";
import { makeTask } from "./taskFixtures";

const epic = makeTask({ id: "epic", title: "Checkout epic", taskType: "epic", number: 1 });
const story = makeTask({ id: "story", title: "Payment story", parentId: "epic", number: 2 });
const current = makeTask({ id: "a", title: "Card form", parentId: "epic", number: 3 });
const sibling = makeTask({ id: "b", title: "Card validation", parentId: "epic", number: 4 });
const doneSibling = makeTask({
  id: "c",
  title: "Card styles",
  parentId: "epic",
  number: 5,
  completedAt: "2026-10-01T00:00:00Z",
});
const nested = makeTask({ id: "d", title: "Payment retries", parentId: "story", number: 6 });
const unrelatedOld = makeTask({
  id: "e",
  title: "Old onboarding",
  number: 7,
  updatedAt: "2026-01-01T00:00:00Z",
});
const unrelatedNew = makeTask({
  id: "f",
  title: "Fresh dashboard",
  number: 8,
  updatedAt: "2026-10-30T00:00:00Z",
});
const tasks = [epic, story, current, sibling, doneSibling, nested, unrelatedOld, unrelatedNew];

function sectionIds(query = "", excludeIds: string[] = []) {
  return rankBlockerCandidates(current, tasks, { query, excludeIds }).map((section) => ({
    key: section.key,
    ids: section.tasks.map((t) => t.id),
  }));
}

describe("rankBlockerCandidates", () => {
  it("offers subtasks, which the picker used to drop", () => {
    const ids = sectionIds().flatMap((section) => section.ids);
    expect(ids).toContain("b");
    expect(ids).toContain("d");
  });

  it("orders siblings, then the same epic, then recent, then the rest", () => {
    expect(sectionIds()).toEqual([
      { key: "siblings", ids: ["story", "b", "c"] },
      { key: "epic", ids: ["d"] },
      { key: "recent", ids: ["f", "e", "epic"] },
    ]);
  });

  it("sorts done tasks last inside a section", () => {
    const siblings = sectionIds().find((section) => section.key === "siblings");
    expect(siblings?.ids.at(-1)).toBe("c");
  });

  it("never offers the task itself or excluded ids", () => {
    const ids = sectionIds("", ["b"]).flatMap((section) => section.ids);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
  });

  it("filters by title and by number, keeping the ranking", () => {
    expect(sectionIds("card")).toEqual([{ key: "siblings", ids: ["b", "c"] }]);
    expect(sectionIds("#6")).toEqual([{ key: "epic", ids: ["d"] }]);
  });

  it("puts only the five most recently updated open tasks in the recent section", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      makeTask({
        id: `r${i}`,
        title: `Loose ${i}`,
        number: 100 + i,
        updatedAt: `2026-10-0${i + 1}T00:00:00Z`,
      }),
    );
    const top = makeTask({ id: "top", title: "Top", number: 99 });
    const sections = rankBlockerCandidates(top, [top, ...many], { query: "", excludeIds: [] });
    expect(sections.map((s) => s.key)).toEqual(["recent", "other"]);
    expect(sections[0].tasks.map((t) => t.id)).toEqual(["r7", "r6", "r5", "r4", "r3"]);
    expect(sections[1].tasks.map((t) => t.id)).toEqual(["r0", "r1", "r2"]);
  });

  it("leaves out tasks of other projects and deleted tasks", () => {
    const foreign = makeTask({ id: "x", projectId: "proj-2", parentId: "epic" });
    const deleted = makeTask({ id: "y", parentId: "epic", deletedAt: "2026-10-01T00:00:00Z" });
    const ids = rankBlockerCandidates(current, [...tasks, foreign, deleted], {
      query: "",
      excludeIds: [],
    }).flatMap((section) => section.tasks.map((t) => t.id));
    expect(ids).not.toContain("x");
    expect(ids).not.toContain("y");
  });
});

describe("parentLabel", () => {
  it("names the parent so tasks with the same title can be told apart", () => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(parentLabel(nested, byId)).toBe("Payment story");
    expect(parentLabel(epic, byId)).toBeNull();
  });
});
