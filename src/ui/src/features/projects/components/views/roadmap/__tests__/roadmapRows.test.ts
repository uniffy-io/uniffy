import { describe, expect, it } from "vitest";
import {
  buildGroupedRows,
  buildOrderedRows,
} from "@/features/projects/components/views/roadmap/roadmapRows";
import type { TaskGroup } from "@/features/projects/utils/groupTasks";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";

function group(key: string, tasks: TaskGroup["tasks"]): TaskGroup {
  return { key, label: key, value: { kind: "id", id: key }, display: "plain", tasks };
}

describe("roadmap rows", () => {
  const parent = makeTask({ id: "p" });
  const child = makeTask({ id: "c", parentId: "p" });
  const other = makeTask({ id: "o" });

  it("nests subtasks under their parent", () => {
    expect(
      buildOrderedRows([parent, child, other], new Set()).map((r) => [r.key, r.depth]),
    ).toEqual([
      ["p", 0],
      ["c", 1],
      ["o", 0],
    ]);
  });

  it("keeps the hierarchy inside a group and promotes a child whose parent sits elsewhere", () => {
    const rows = buildGroupedRows(
      [group("amy", [parent, child]), group("zoe", [child, other])],
      new Set(),
      new Set(),
    );
    expect(rows.map((row) => (row.kind === "group" ? row.key : `${row.key}@${row.depth}`))).toEqual(
      ["group:amy", "amy:p@0", "amy:c@1", "group:zoe", "zoe:c@0", "zoe:o@0"],
    );
  });

  it("drops the rows of a collapsed group but keeps its header", () => {
    const rows = buildGroupedRows(
      [group("amy", [parent]), group("zoe", [other])],
      new Set(),
      new Set(["amy"]),
    );
    expect(rows.map((row) => row.key)).toEqual(["group:amy", "group:zoe", "zoe:o"]);
    expect(rows[0].kind === "group" && rows[0].collapsed).toBe(true);
  });
});
