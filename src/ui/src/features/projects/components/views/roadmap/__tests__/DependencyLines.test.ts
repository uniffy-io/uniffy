import { expect, it } from "vitest";
import type { ReactElement } from "react";
import { DependencyLines } from "@/features/projects/components/views/roadmap/DependencyLines";
import { buildGroupedRows } from "@/features/projects/components/views/roadmap/roadmapRows";
import { LAYOUT } from "@/features/projects/constants";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import type { TaskGroup } from "@/features/projects/utils/groupTasks";

const blocker = makeTask({ id: "blocker" });
const dependent = makeTask({ id: "dependent", blockedByTaskIds: [blocker.id] });
function group(key: string, tasks = [blocker, dependent]): TaskGroup {
  return { key, label: key, value: { kind: "id", id: key }, display: "plain", tasks };
}
function render(groups: TaskGroup[], collapsed = new Set<string>()) {
  const rows = buildGroupedRows(groups, new Set(), collapsed);
  const tasks = rows.flatMap((row, index) =>
    row.kind === "task"
      ? [
          {
            id: row.task.id,
            key: row.key,
            groupKey: row.groupKey,
            row: index,
            blockedByTaskIds: row.task.blockedByTaskIds,
            left: row.task.id === blocker.id ? 10 : 100,
            width: 20,
          },
        ]
      : [],
  );
  return DependencyLines({ tasks });
}
function paths(svg: NonNullable<ReturnType<typeof render>>) {
  return svg.props.children[1] as ReactElement<{ children: ReactElement<{ d: string }> }>[];
}
const center = (row: number) => (row + 0.5) * LAYOUT.ROADMAP_ROW_HEIGHT;

it("connects repeated tasks within each group with unique edge keys", () => {
  const svg = render([group("amy"), group("zoe")])!;
  const lines = paths(svg);
  expect(lines).toHaveLength(2);
  expect(new Set(lines.map((line) => line.key)).size).toBe(2);
  expect(lines[0].props.children.props.d).toMatch(
    new RegExp(`^M 30 ${center(1)} .*L 100 ${center(2)}$`),
  );
  expect(lines[1].props.children.props.d).toMatch(
    new RegExp(`^M 30 ${center(4)} .*L 100 ${center(5)}$`),
  );
  expect(svg.props.style.minHeight).toBe(6 * LAYOUT.ROADMAP_ROW_HEIGHT);
});

it("uses first visible blocker when dependent has no blocker in its group", () => {
  const lines = paths(
    render([group("amy", [blocker]), group("zoe", [blocker]), group("pat", [dependent])])!,
  );
  expect(lines).toHaveLength(1);
  expect(lines[0].props.children.props.d).toMatch(
    new RegExp(`^M 30 ${center(1)} .*L 100 ${center(5)}$`),
  );
});

it("excludes collapsed occurrences and keeps remaining row indices aligned", () => {
  const lines = paths(render([group("amy"), group("zoe")], new Set(["amy"]))!);
  expect(lines).toHaveLength(1);
  expect(lines[0].props.children.props.d).toMatch(
    new RegExp(`^M 30 ${center(2)} .*L 100 ${center(3)}$`),
  );
});

it("omits dependency when every blocker occurrence is hidden", () => {
  expect(render([group("amy", [blocker]), group("zoe", [dependent])], new Set(["amy"]))).toBeNull();
});
